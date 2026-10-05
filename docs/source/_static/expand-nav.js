// Open the sidebar's top-level sections, so each page's subpages show without
// a click. Furo collapses them; ticking its own toggles keeps the arrows right.
for (const toggle of document.querySelectorAll(
  ".sidebar-tree .toctree-l1 > .toctree-checkbox",
)) {
  toggle.checked = true;
}
