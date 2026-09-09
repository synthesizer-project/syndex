/**
 * Open a preview plot at full size when its thumbnail is clicked.
 *
 * A native <dialog> is used rather than a hand-built modal: it provides the
 * focus trap, the Escape key, the inert background and the backdrop, all of
 * which are easy to get subtly wrong by hand.
 *
 * Without JavaScript the thumbnail stays an ordinary link to the image, so the
 * plot is still reachable.
 */
(() => {
  "use strict";

  /** @type {HTMLDialogElement | null} */
  let dialog = null;

  /**
   * Build the dialog once and reuse it for every thumbnail on the page.
   *
   * @returns {HTMLDialogElement} The overlay dialog.
   */
  function overlay() {
    if (dialog !== null) {
      return dialog;
    }
    dialog = document.createElement("dialog");
    dialog.className = "preview-overlay";
    dialog.innerHTML =
      '<button type="button" class="preview-close" aria-label="Close">' +
      "×</button><figure style=\"margin:0\">" +
      '<img alt="" /><figcaption></figcaption></figure>';

    dialog.querySelector(".preview-close").addEventListener("click", () => {
      dialog.close();
    });

    // Clicking outside the figure closes it, which is what the backdrop looks
    // like it should do. The dialog element itself is the backdrop's hit area,
    // so a click landing on the dialog rather than its contents means outside.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    document.body.appendChild(dialog);
    return dialog;
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-preview]");
    if (link === null) {
      return;
    }
    // Leave modified clicks alone: a middle click or cmd-click should still
    // open the image in a new tab.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();

    const shown = overlay();
    const image = shown.querySelector("img");
    const caption = shown.querySelector("figcaption");
    const thumbnail = link.querySelector("img");

    image.src = link.getAttribute("href");
    image.alt = thumbnail === null ? "" : thumbnail.alt;
    const figure = link.closest("figure");
    const original = figure === null ? null : figure.querySelector("figcaption");
    caption.textContent = original === null ? "" : original.textContent;

    shown.showModal();
  });
})();
