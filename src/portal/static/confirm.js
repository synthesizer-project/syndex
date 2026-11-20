/**
 * Asks before a form does something that is awkward to take back.
 *
 * A form, or the button that submits it, says what it is about to do in a
 * `data-confirm` attribute, and this puts that question to the reader first.
 * The button wins when both carry one, which is what lets Approve and Reject
 * share a form and ask different things.
 *
 * The browser's own dialog rather than one drawn here: it is modal, it is
 * announced, it answers to Enter and Escape, and it cannot be styled into
 * something that looks like the page and so gets clicked through.
 *
 * Enhancement rather than requirement. Without this the form still submits,
 * as it did before there was a question.
 */
document.addEventListener("submit", (event) => {
  const question =
    event.submitter?.dataset.confirm ?? event.target.dataset.confirm;
  if (question && !window.confirm(question)) {
    event.preventDefault();
  }
});
