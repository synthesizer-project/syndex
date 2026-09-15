/**
 * Sends one chosen file to the portal, a piece at a time.
 *
 * The only JavaScript in the portal that does anything, and it is confined to
 * the upload step: the catalogue itself needs none. It slices the file into
 * parts and posts each one, then submits the ordinary form that asks the
 * Worker to assemble them and go and look at what arrived. If any of it
 * fails, that form is still there to be pressed by hand after uploading some
 * other way.
 *
 * Parts go up one at a time rather than several at once. The limit on a
 * transfer this size is the sending connection, which concurrency does not
 * widen, and sequential parts mean a failure has one place to resume from
 * rather than several.
 *
 * A part that fails is retried rather than abandoned. Over a transfer of
 * three hundred parts, one failing at some point is ordinary rather than
 * exceptional, and re-sending a part is safe: the Worker records each by
 * number, so a repeat replaces it instead of adding to it.
 */

/** How many times one part is re-sent before the transfer gives up. */
const RETRIES = 3;

/** How long to wait before re-sending, doubling each time. */
const BACKOFF_MS = 1000;

/**
 * A size in the same decimal units the rest of the portal uses.
 *
 * @param {number} bytes The size.
 * @returns {string} Something to put in a sentence.
 */
function gigabytes(bytes) {
  const value = bytes / 1000 ** 3;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0)} GB`;
}

/**
 * Send one part, reporting how much of it has gone.
 *
 * XMLHttpRequest rather than fetch, for the one thing fetch cannot do: report
 * upload progress. Without it the bar moves only as each part lands, which on
 * a file of three parts is three jumps and looks for all the world like a
 * transfer that has stopped.
 *
 * @param {string} url Where this part belongs.
 * @param {Blob} chunk The bytes.
 * @param {Function} onProgress Called with the bytes sent so far of this part.
 * @returns {Promise<void>} Resolves when the part is stored.
 */
function postPart(url, chunk, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url, true);

    request.upload.addEventListener("progress", (event) => {
      onProgress(event.loaded);
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      let message;
      try {
        message = JSON.parse(request.responseText).error;
      } catch {
        message = undefined;
      }
      const error = new Error(message ?? `the portal answered ${request.status}`);
      error.status = request.status;
      reject(error);
    });

    request.addEventListener("error", () =>
      reject(new Error("the connection failed")),
    );
    request.send(chunk);
  });
}

/**
 * Send one part, retrying a failure that might not be permanent.
 *
 * @param {string} url Where this part belongs.
 * @param {Blob} chunk The bytes.
 * @param {Function} onProgress Called with the bytes sent so far of this part.
 * @returns {Promise<void>} Resolves when the part is stored.
 */
async function sendPart(url, chunk, onProgress) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await postPart(url, chunk, onProgress);
      return;
    } catch (error) {
      // A refusal is the server's final answer -- the submission is finished,
      // the file is too large, the session has ended -- and retrying it would
      // only delay saying so. A 5xx or a dropped connection might not be.
      const permanent = error.status !== undefined && error.status < 500;
      if (permanent || attempt >= RETRIES) {
        throw error;
      }
      // Starting the part again means the bytes it had counted are not sent.
      onProgress(0);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, BACKOFF_MS * 2 ** attempt);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const picker = document.getElementById("pick");
  const chooser = document.getElementById("picker");
  const chosen = document.getElementById("chosen");
  const pickLabel = document.getElementById("pick-label");
  const tooLargeWarning = document.getElementById("too-large");
  const tooLargeDetail = document.getElementById("too-large-detail");
  const send = document.getElementById("send");
  const progress = document.getElementById("progress");
  const status = document.getElementById("upload-status");
  const confirm = document.getElementById("confirm");
  const expected = document.getElementById("expected-size");

  if (
    picker === null ||
    chooser === null ||
    pickLabel === null ||
    send === null
  ) {
    return;
  }

  // The controls are inert until this runs, so that a browser with no
  // JavaScript is never shown a file picker that cannot do anything. The
  // upload button waits for a file as well: a disabled button asks to be
  // pressed and then refuses, where an absent one asks for the file first.
  chooser.hidden = false;

  const partSize = Number(send.dataset.partSize);
  const maxParts = Number(send.dataset.maxParts);
  const limit = partSize * maxParts;

  picker.addEventListener("change", () => {
    const [file] = picker.files;
    const tooLarge = file !== undefined && file.size > limit;

    // The one button changes job rather than a second appearing beside it:
    // choose a file, then send it. A file too large to send leaves the
    // chooser in place, since picking another is the way out of that.
    const ready = file !== undefined && !tooLarge;
    send.hidden = !ready;
    send.disabled = !ready;
    pickLabel.hidden = ready;

    chosen.textContent = file === undefined ? "No file chosen" : file.name;

    tooLargeWarning.hidden = !tooLarge;
    if (tooLarge) {
      tooLargeDetail.textContent =
        `${file.name} is ${gigabytes(file.size)}, and the browser can send up` +
        ` to ${gigabytes(limit)}. A file this size has to go up from the` +
        " command line instead — see below. That route is still being built," +
        " so for now ask a maintainer to take the file.";
    }
    status.textContent = "";
  });

  send.addEventListener("click", async () => {
    const [file] = picker.files;
    if (file === undefined) {
      return;
    }

    send.disabled = true;
    send.hidden = true;
    picker.disabled = true;
    progress.hidden = false;
    progress.max = file.size;
    // What the server checks the assembled object against. A transfer that
    // stopped part way is the failure this catches, and the size answers it
    // without anybody being asked to hash 30 GB by hand.
    expected.value = String(file.size);

    const parts = Math.ceil(file.size / partSize);

    for (let index = 0; index < parts; index += 1) {
      const start = index * partSize;
      const chunk = file.slice(start, start + partSize);

      const show = (sentOfPart) => {
        const sent = start + sentOfPart;
        progress.value = sent;
        const percent = Math.floor((sent / file.size) * 100);
        status.textContent =
          parts === 1
            ? `Uploading ${file.name}: ${percent}%`
            : `Uploading ${file.name}: ${percent}% (piece ${index + 1} of ${parts})`;
      };
      show(0);

      try {
        // Parts count from one, as R2 numbers them.
        await sendPart(`${send.dataset.partUrl}/${index + 1}`, chunk, show);
      } catch (error) {
        status.textContent =
          `The upload stopped at piece ${index + 1}: ${error.message}.` +
          " Reload this page and choose the file again to carry on; the" +
          " pieces already sent are kept.";
        pickLabel.hidden = false;
        send.hidden = true;
        picker.disabled = false;
        return;
      }

      progress.value = start + chunk.size;
    }

    status.textContent = "Uploaded. Checking what arrived…";
    // The Worker assembles the parts and reads the size back from storage
    // rather than believing anything this page says about it.
    confirm.submit();
  });
});
