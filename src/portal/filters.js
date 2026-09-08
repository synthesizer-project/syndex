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

const filterHeight = new ResizeObserver(([entry]) => {
  entry.target
    .closest("#catalogue-grid")
    ?.style.setProperty(
      "--filter-height",
      `${entry.target.getBoundingClientRect().height}px`,
    );
});

function syncFilterHeight() {
  filterHeight.disconnect();
  const rail = document.querySelector("#catalogue-grid > [data-filter-column]");
  if (rail !== null) {
    filterHeight.observe(rail);
  }
}

syncFilterHeight();
document.addEventListener("htmx:afterSwap", syncFilterHeight);

const selectedDatasets = new Set();

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
    } else {
      selectedDatasets.delete(event.target.value);
    }
    updateBulkSelection();
  }

  if (event.target.matches("[data-select-all]")) {
    for (const box of document.querySelectorAll("[data-dataset-select]")) {
      if (event.target.checked) {
        selectedDatasets.add(box.value);
      } else {
        selectedDatasets.delete(box.value);
      }
    }
    updateBulkSelection();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-bulk-command]")) {
    const commands = `synthesizer-download --dataset ${[
      ...selectedDatasets,
    ]
      .sort()
      .join(" ")}`;
    document.querySelector("[data-bulk-command-text]").textContent = commands;
    document.querySelector("[data-copy-bulk-command]").textContent = "Copy commands";
    document.querySelector("#bulk-command").showModal();
  }

  const copy = event.target.closest("[data-copy-bulk-command]");
  if (copy !== null) {
    const commands = document.querySelector("[data-bulk-command-text]").textContent;
    try {
      await navigator.clipboard.writeText(commands);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select and copy above";
    }
  }
});

document.addEventListener("htmx:afterSwap", updateBulkSelection);
updateBulkSelection();
