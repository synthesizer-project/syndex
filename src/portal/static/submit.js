/**
 * The two things on the submission form that CSS cannot do.
 *
 * Everything else there works with no JavaScript at all: the questions that
 * reveal fields, and the fields that appear once a data type is chosen, are a
 * checkbox and a `:has()` rule. These two cannot be, so both are enhancement
 * rather than requirement.
 *
 * Adding a citation box: the form renders one, and the button that adds more
 * is hidden until this runs. That costs nothing that was not already spent --
 * sending the file needs JavaScript too, so a browser without it cannot
 * complete a submission either way.
 *
 * Swapping the placeholder examples: a placeholder is an attribute, and CSS
 * cannot set one. Without this they stay on the commonest data type, which is
 * a real example rather than nothing.
 */

/** As many as anyone is plausibly going to need, and a stop on a stuck key. */
const MAX_ROWS = 20;

document.addEventListener("DOMContentLoaded", () => {
  const rows = document.getElementById("citations");
  const add = document.getElementById("add-citation");

  if (rows === null || add === null) {
    return;
  }

  add.hidden = false;

  add.addEventListener("click", () => {
    const boxes = rows.querySelectorAll("input");
    // Cloned rather than constructed, so the new box keeps whatever classes,
    // placeholder and length limit the server gave the others and cannot
    // drift from them.
    const next = boxes[boxes.length - 1].cloneNode(true);
    next.value = "";
    rows.append(next);
    next.focus();

    if (rows.querySelectorAll("input").length >= MAX_ROWS) {
      add.hidden = true;
    }
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("submit-form");
  const type = document.getElementById("data_type");

  if (form === null || type === null || !form.dataset.examples) {
    return;
  }

  let examples;
  try {
    examples = JSON.parse(form.dataset.examples);
  } catch {
    // Better to leave the defaults the server rendered than to clear them.
    return;
  }

  type.addEventListener("change", () => {
    const example = examples[type.value];
    if (example === undefined) {
      return;
    }
    for (const [field, text] of Object.entries(example)) {
      const box = form.elements[field];
      if (box !== undefined) {
        box.placeholder = text;
      }
    }
  });
});
