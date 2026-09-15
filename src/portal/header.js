/**
 * Closes the header menu when you click away from it, or press Escape.
 *
 * The menu is a details element, so it opens, closes and is reachable by
 * keyboard with no script at all. This is the one behaviour that element does
 * not have: it closes on its own button and on nothing else, which leaves an
 * open menu sitting over the page while somebody clicks at what is underneath
 * it and nothing happens.
 *
 * Enhancement rather than requirement. Without this the menu still works --
 * it just takes a second click on the button to put it away.
 */

/** Close every open menu that the event happened outside of. */
function closeMenus(target) {
  for (const menu of document.querySelectorAll(".header-menu[open]")) {
    if (target === null || !menu.contains(target)) {
      menu.open = false;
    }
  }
}

// Capture, so a menu closes even when something inside the page stops the
// click from bubbling on its way up.
document.addEventListener(
  "click",
  (event) => {
    closeMenus(event.target);
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus(null);
  }
});
