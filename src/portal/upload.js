/**
 * Sends one chosen file straight to R2.
 *
 * The only JavaScript in the portal that does anything, and it is confined
 * to the upload step: the catalogue itself needs none. It asks the portal
 * for a presigned PUT, sends the bytes to R2 with an XMLHttpRequest because
 * that is what reports progress, and then submits the ordinary form that
 * asks the Worker to go and look at what arrived. If any of it fails, that
 * form is still there to be pressed by hand after uploading some other way.
 */

document.addEventListener("DOMContentLoaded", () => {
  const picker = document.getElementById("pick");
  const send = document.getElementById("send");
  const progress = document.getElementById("progress");
  const status = document.getElementById("upload-status");
  const confirm = document.getElementById("confirm");

  if (picker === null || send === null) {
    return;
  }

  // The controls are inert until this runs, so that a browser with no
  // JavaScript is never shown a file picker that cannot do anything.
  picker.hidden = false;
  send.hidden = false;

  const limit = Number(send.dataset.limit);

  picker.addEventListener("change", () => {
    const [file] = picker.files;
    send.disabled = file === undefined || file.size > limit;
    if (file !== undefined && file.size > limit) {
      status.textContent =
        `${file.name} is too large to send from a browser. Use the` +
        " command below instead, which resumes if it is interrupted.";
    } else if (file !== undefined) {
      status.textContent = `${file.name} is ready to send.`;
    }
  });

  send.addEventListener("click", async () => {
    const [file] = picker.files;
    if (file === undefined) {
      return;
    }

    send.disabled = true;
    picker.disabled = true;
    status.textContent = "Asking for somewhere to put it…";

    let target;
    try {
      const response = await fetch(send.dataset.mint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!response.ok) {
        throw new Error(`the portal answered ${response.status}`);
      }
      target = await response.json();
    } catch (error) {
      status.textContent = `Could not start the upload: ${error.message}.`;
      send.disabled = false;
      picker.disabled = false;
      return;
    }

    progress.hidden = false;
    progress.max = file.size;

    const request = new XMLHttpRequest();
    request.open("PUT", target.url, true);
    request.upload.addEventListener("progress", (event) => {
      progress.value = event.loaded;
      const percent = Math.floor((event.loaded / event.total) * 100);
      status.textContent = `Sending ${file.name}: ${percent}%`;
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        status.textContent = "Sent. Checking what arrived…";
        // The Worker looks in the bucket itself rather than believing this.
        confirm.submit();
      } else {
        status.textContent =
          `The upload was refused with status ${request.status}. The link` +
          " may have expired; reload this page to get another.";
        send.disabled = false;
        picker.disabled = false;
      }
    });
    request.addEventListener("error", () => {
      status.textContent =
        "The upload failed part way through. Reload to try again, or use" +
        " the command below, which resumes.";
      send.disabled = false;
      picker.disabled = false;
    });
    request.send(file);
  });
});
