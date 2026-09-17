/**
 * The portal's only browser script: filter-rail state, bulk selection, and
 * the two command dialogs.
 *
 * Everything here is an enhancement of something that already works without
 * it. The filter form submits and the results render server-side; this keeps
 * an open facet open across a swap, remembers a selection that survives one,
 * and turns a download link into a dialog that says how large the file is
 * before it starts.
 */

document.addEventListener(
  "toggle",
  (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.dataset.filterGroup) {
      return;
    }

    const form = details.closest("#filters");
    if (form === null) {
      return;
    }

    const group = details.dataset.filterGroup;
    const existing = [...form.querySelectorAll("[data-filter-open]")].find(
      (input) => input.value === group,
    );
    if (details.open && existing === undefined) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "open";
      input.value = group;
      input.dataset.filterOpen = "";
      details.append(input);
    } else if (!details.open) {
      existing?.remove();
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    for (const opened of form.querySelectorAll("details[data-filter-group][open]")) {
      url.searchParams.append("open", opened.dataset.filterGroup);
    }
    history.replaceState(history.state, "", url);
  },
  true,
);

// What the reader has ticked, kept here rather than read back out of the DOM
// on every change: the rows are replaced wholesale by htmx, so a checkbox that
// was ticked before a swap no longer exists afterwards, and a selection that
// lived in the markup would be lost every time the filters changed.
const selectedDatasets = new Set();
const selectedSizes = new Map();
/**
 * The browser's copy of `size()` from views/format.jsx, which is server-only.
 * Keep the two in step: both count in decimal and both drop a bare ".0".
 *
 * @param {number} bytes Size in bytes.
 * @returns {string} Human-readable size.
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "\u2014";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${value.toFixed(0)} ${units[unit]}`;
  const shown =
    value < 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(0);
  return `${shown} ${units[unit]}`;
}

/**
 * Ask before a click becomes a multi-gigabyte download.
 *
 * @param {string} filename What is about to be fetched.
 * @param {string} amount Its size, already formatted.
 * @param {string} href Where the download goes.
 */
function showDownloadNotice(filename, amount, href) {
  const notice = document.querySelector("#download-notice");
  if (notice === null) return;
  notice.querySelector("[data-download-filename]").textContent = filename;
  notice.querySelector("[data-download-size-value]").textContent = amount;
  const button = notice.querySelector("[data-confirm-download]");
  button.onclick = () => {
    notice.close();
    window.location.href = href;
  };
  notice.showModal();
}

/**
 * Recount what is ticked, and show or hide the command button to match.
 *
 * Called on every change rather than tracking a running total, because the
 * table is replaced wholesale by htmx and a total kept alongside it would
 * survive a swap that its checkboxes did not.
 */
function updateBulkSelection() {
  const boxes = [...document.querySelectorAll("[data-dataset-select]")];
  for (const box of boxes) {
    box.checked = selectedDatasets.has(box.value);
  }

  const selectAll = document.querySelector("[data-select-all]");
  if (selectAll !== null) {
    const selectedHere = boxes.filter((box) => box.checked).length;
    selectAll.checked = boxes.length > 0 && selectedHere === boxes.length;
    selectAll.indeterminate = selectedHere > 0 && selectedHere < boxes.length;
  }

  const button = document.querySelector("[data-bulk-command]");
  if (button !== null) {
    button.hidden = selectedDatasets.size === 0;
  }
  const count = document.querySelector("[data-selection-count]");
  if (count !== null) {
    count.textContent = String(selectedDatasets.size);
  }
}

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-dataset-select]")) {
    if (event.target.checked) {
      selectedDatasets.add(event.target.value);
      selectedSizes.set(event.target.value, Number(event.target.dataset.size));
    } else {
      selectedDatasets.delete(event.target.value);
      selectedSizes.delete(event.target.value);
    }
    updateBulkSelection();
  }

  if (event.target.matches("[data-select-all]")) {
    for (const box of document.querySelectorAll("[data-dataset-select]")) {
      if (event.target.checked) {
        selectedDatasets.add(box.value);
        selectedSizes.set(box.value, Number(box.dataset.size));
      } else {
        selectedDatasets.delete(box.value);
        selectedSizes.delete(box.value);
      }
    }
    updateBulkSelection();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-close-command-dialog]")) {
    document.querySelector("#bulk-command")?.close();
    return;
  }

  if (event.target.closest("[data-close-download-notice]")) {
    document.querySelector("#download-notice")?.close();
    return;
  }

  const download = event.target.closest("a[data-download-size]");
  if (download !== null) {
    event.preventDefault();
    const bytes = Number(download.dataset.downloadSize);
    const amount = download.dataset.downloadSizeLabel ?? formatBytes(bytes);
    const filename = download.dataset.downloadFilename ?? "this file";
    showDownloadNotice(filename, amount, download.href);
  }

  // Copying a value rather than a command: no dialog, just the control saying
  // it worked. The text rides on the attribute because the citations it copies
  // are already on the page.
  const textCopy = event.target.closest("[data-copy-text]");
  if (textCopy !== null) {
    const label = textCopy.dataset.copyLabel ?? "Copy";
    let message = "Copied";
    try {
      await navigator.clipboard.writeText(textCopy.dataset.copyText);
    } catch {
      message = "Copy unavailable";
    }
    textCopy.setAttribute("aria-label", message);
    textCopy.querySelector("[role=tooltip]").textContent = message;
    textCopy.classList.toggle("text-accent-light", message === "Copied");
    // Back to itself, so a second copy still reads as one.
    setTimeout(() => {
      textCopy.setAttribute("aria-label", label);
      textCopy.querySelector("[role=tooltip]").textContent = label;
      textCopy.classList.remove("text-accent-light");
    }, 2000);
    return;
  }

  const commandCopy = event.target.closest("[data-copy-command]");
  if (commandCopy !== null) {
    const amount = commandCopy.dataset.downloadSizeLabel;
    let copied = false;
    try {
      await navigator.clipboard.writeText(commandCopy.dataset.copyCommand);
      copied = true;
      commandCopy.setAttribute("aria-label", "Copied");
      commandCopy.querySelector("[role=tooltip]").textContent = "Copied";
      commandCopy.classList.add("text-accent-light");
    } catch {
      commandCopy.setAttribute("aria-label", "Copy unavailable");
      commandCopy.querySelector("[role=tooltip]").textContent = "Copy unavailable";
    }
    const dialog = document.querySelector("#bulk-command");
    dialog.querySelector("[data-command-eyebrow]").hidden = copied;
    dialog.querySelector("[data-command-title]").textContent = copied
      ? "Command copied"
      : "Download command";
    const intro = dialog.querySelector("[data-command-intro]");
    intro.hidden = copied;
    intro.textContent = "Clipboard unavailable; use the copy control below.";
    dialog
      .querySelector("[data-command-content]")
      .classList.remove("size-first");
    const filename = dialog.querySelector("[data-command-filename]");
    filename.hidden = false;
    filename.textContent = commandCopy.dataset.downloadFilename ?? "";
    dialog.querySelector("[data-command-size-label]").textContent = "Download size";
    const size = dialog.querySelector("[data-bulk-size]");
    size.classList.remove("mt-0");
    size.textContent = amount ?? "\u2014";
    dialog.querySelector("[data-bulk-command-text]").textContent =
      commandCopy.dataset.copyCommand;
    const dialogCopy = dialog.querySelector("[data-copy-bulk-command]");
    dialogCopy.hidden = copied;
    dialogCopy.setAttribute("aria-label", copied ? "Copied" : "Copy command");
    dialogCopy.querySelector("[role=tooltip]").textContent = copied
      ? "Copied"
      : "Copy command";
    dialogCopy.classList.toggle("text-accent-light", copied);
    dialog.showModal();
  }

  if (event.target.closest("[data-bulk-command]")) {
    const commands = `synthesizer-download --dataset ${[
      ...selectedDatasets,
    ]
      .sort()
      .join(" ")}`;
    const total = [...selectedSizes.values()].reduce(
      (sum, bytes) => sum + (Number.isFinite(bytes) ? bytes : 0),
      0,
    );
    document.querySelector("[data-bulk-command-text]").textContent = commands;
    document.querySelector("[data-command-title]").textContent =
      `${selectedDatasets.size} dataset${
        selectedDatasets.size === 1 ? "" : "s"
      } selected`;
    document.querySelector("[data-command-eyebrow]").hidden = false;
    const intro = document.querySelector("[data-command-intro]");
    intro.hidden = false;
    intro.textContent = "One command downloads the complete selection.";
    document
      .querySelector("[data-command-content]")
      .classList.add("size-first");
    document.querySelector("[data-command-filename]").hidden = true;
    document.querySelector("[data-command-size-label]").textContent =
      "Download size";
    const size = document.querySelector("[data-bulk-size]");
    size.classList.add("mt-0");
    size.textContent = formatBytes(total);
    const bulkCopy = document.querySelector("[data-copy-bulk-command]");
    bulkCopy.hidden = false;
    bulkCopy.setAttribute("aria-label", "Copy command");
    bulkCopy.querySelector("[role=tooltip]").textContent = "Copy command";
    bulkCopy.classList.remove("text-accent-light");
    document.querySelector("#bulk-command").showModal();
  }

  const copy = event.target.closest("[data-copy-bulk-command]");
  if (copy !== null) {
    const commands = document.querySelector("[data-bulk-command-text]").textContent;
    try {
      await navigator.clipboard.writeText(commands);
      copy.setAttribute("aria-label", "Copied");
      copy.querySelector("[role=tooltip]").textContent = "Copied";
      copy.classList.add("text-accent-light");
    } catch {
      copy.setAttribute("aria-label", "Copy unavailable");
      copy.querySelector("[role=tooltip]").textContent = "Copy unavailable";
    }
  }
});

document.addEventListener("htmx:afterSwap", updateBulkSelection);
updateBulkSelection();
