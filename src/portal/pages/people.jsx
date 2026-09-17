/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

/**
 * Other people's accounts: who is waiting for access, and who has it.
 *
 * Separate from `account.jsx`, which is what somebody sees about themselves.
 * These are the rows and forms a reviewer or an admin reads, and they appear
 * in two places -- inline on the review page, where granting access is part
 * of clearing the queue, and in full on the accounts page when the list has
 * outgrown that. Both render the same rows, so they live here rather than in
 * either of the pages that use them.
 *
 * Roles are ordered, and every refusal in here follows from that order: you
 * cannot grant what you do not hold, and you cannot change your own.
 */

import { BASE } from "../base.js";
import { date } from "../views/format.jsx";
import { Layout } from "../views/layout.jsx";
import { Fields, Overlay, PencilIcon } from "./shared.jsx";

/**
 * How many accounts the review page shows before sending you elsewhere.
 *
 * The review page is for deciding things. A list of everyone who has ever
 * signed in is reference material, and past a handful it pushes the queue --
 * the thing that actually needs attention -- off the screen.
 */
export const ACCOUNTS_SHOWN = 10;

/**
 * The control that changes one account's role.
 *
 * @param {object} props Component props.
 * @param {object} props.person The account being changed.
 * @param {string[]} props.grantable Roles the viewer may set.
 * @param {object} props.viewer The reviewer reading the page.
 * @param {string} props.from Which page to render once it is done.
 * @returns {unknown} The rendered form, or a note in place of one.
 */
const RoleForm = ({ person, grantable, viewer, from }) => {
  // Changing your own role is refused rather than hidden, since the reason is
  // not obvious: it is what stops the last admin removing the authority
  // needed to restore it.
  if (person.user_id === viewer.user_id) {
    return <p class="text-sm text-muted">This is your own account.</p>;
  }
  if (!grantable.includes(person.role)) {
    return (
      <p class="text-sm text-muted">
        Only an admin can change a {person.role}.
      </p>
    );
  }

  return (
    <form
      method="post"
      action={`${BASE}/review/users/${person.user_id}`}
      class="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="from" value={from} />
      <label for={`role-${person.user_id}`} class="flex-1">
        <span class="label-caps mb-1 block">Role</span>
        <select
          id={`role-${person.user_id}`}
          name="role"
          class="w-full rounded-lg border border-muted bg-bg px-3 py-1.5"
        >
          {grantable.map((role) => (
            <option value={role} selected={role === person.role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" class="btn">
        Save
      </button>
    </form>
  );
};

/**
 * One account, as a row with the way to change it on the right.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered row and its overlay.
 */
export const AccountRow = ({ person, grantable, viewer, from }) => (
  <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
    <span class="font-mono text-sm">{person.login}</span>
    <span class="flex-1 truncate text-sm text-muted">{person.name}</span>
    <span class="label-caps">{person.role}</span>
    <button
      type="button"
      popovertarget={`account-${person.user_id}`}
      aria-label={`Edit ${person.login}`}
      class="btn-quiet inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs"
    >
      <PencilIcon />
      Edit
    </button>
    <Overlay id={`account-${person.user_id}`} title={person.login}>
      <Fields
        entries={[
          ["name", person.name],
          ["role", person.role],
          ["joined", person.created_at ? date(person.created_at) : null],
          [
            "last seen",
            person.last_seen_at ? date(person.last_seen_at) : null,
          ],
          [
            "asked for access",
            person.access_requested_at
              ? date(person.access_requested_at)
              : null,
          ],
        ]}
      />
      <div class="mt-5 border-t border-line pt-5">
        <RoleForm
          person={person}
          grantable={grantable}
          viewer={viewer}
          from={from}
        />
        <RevokeForm person={person} grantable={grantable} viewer={viewer} from={from} />
      </div>
    </Overlay>
  </li>
);

/**
 * Sign an account out and leave it with nothing.
 *
 * A role change alone already takes effect at once, because the role is read
 * from the table on every request rather than carried in the cookie. This is
 * for when that is not enough: a shared machine, or a credential somebody
 * else now has. It ends every session as well as the role.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered form, or nothing when it does not apply.
 */
const RevokeForm = ({ person, grantable, viewer, from }) => {
  if (
    person.user_id === viewer.user_id ||
    !grantable.includes(person.role) ||
    person.role === "pending"
  ) {
    return null;
  }

  return (
    <form
      method="post"
      action={`${BASE}/review/users/${person.user_id}/revoke`}
      class="mt-5 border-t border-line pt-5"
    >
      <input type="hidden" name="from" value={from} />
      <p class="mb-3 text-xs leading-relaxed text-muted">
        Ends every session {person.login} has and leaves them with no role.
        They can sign in again, and will be able to do nothing until a role is
        granted.
      </p>
      <button type="submit" class="btn-quiet cursor-pointer text-xs">
        Sign out and revoke
      </button>
    </form>
  );
};

/**
 * One person waiting for access, as a row with the way to answer on the right.
 *
 * What they wrote lives in the overlay rather than in the row. It is the thing
 * a decision turns on, so it belongs next to the control that decides, and a
 * queue of rows each carrying a paragraph is not a queue anybody scans.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered row and its overlay.
 */
export const RequestRow = ({ person, grantable, viewer, from }) => (
  <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
    <span class="font-mono text-sm">{person.login}</span>
    <span class="flex-1 truncate text-sm text-muted">{person.name}</span>
    <span class="text-xs text-muted">
      asked {date(person.access_requested_at)}
    </span>
    <button
      type="button"
      popovertarget={`request-${person.user_id}`}
      class="btn cursor-pointer px-3 py-1 text-xs"
    >
      Respond
    </button>
    <Overlay
      id={`request-${person.user_id}`}
      title={`${person.login} wants to contribute`}
    >
      {person.access_request_note !== null && (
        <blockquote class="border-l-2 border-line pl-4 text-sm leading-relaxed">
          {person.access_request_note}
        </blockquote>
      )}
      <p class="mt-4 text-xs text-muted">
        Granting any role answers the request. Leaving them pending also
        clears it, so they can ask again with more to say.
      </p>
      <div class="mt-5 border-t border-line pt-5">
        <RoleForm
          person={person}
          grantable={grantable}
          viewer={viewer}
          from={from}
        />
      </div>
    </Overlay>
  </li>
);

/** Weakest first, so a tally reads in the order roles are granted. */
const ROLE_ORDER = ["pending", "contributor", "reviewer", "admin"];

/**
 * Which roles one account may grant.
 *
 * The server enforces this too -- this only keeps a page from offering what
 * it would then refuse.
 *
 * @param {object} viewer The account doing the granting.
 * @returns {string[]} The roles it may set.
 */
export const grantableFor = (viewer) =>
  viewer.role === "admin"
    ? ["pending", "contributor", "reviewer", "admin"]
    : ["pending", "contributor"];

/**
 * Everyone who has ever signed in, on a page of their own.
 *
 * @param {object} props Component props.
 * @returns {unknown} The rendered page.
 */
export const Accounts = ({ counts, people, viewer, note = null }) => {
  // Counted here rather than in SQL: the rows are already loaded, and a
  // second round trip to learn what is in front of you is a poor trade.
  const byRole = people.reduce((tally, person) => {
    tally[person.role] = (tally[person.role] ?? 0) + 1;
    return tally;
  }, {});

  return (
    <Layout title="Accounts" counts={counts} active={null}>
      <p class="mb-4 text-sm">
        <a href={`${BASE}/review`}>Back to the queue</a>
      </p>
      <h1 class="mb-3 text-3xl sm:text-4xl">Accounts</h1>
      <p class="mb-8 max-w-2xl text-muted">
        Everyone who has signed in. Here you can change what each of them is
        allowed to do.
      </p>

      {note !== null && (
        <p role="status" class="mb-8 rounded border border-accent-light p-3 text-sm">
          {note}
        </p>
      )}

      <p class="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <span>{people.length} accounts</span>
        {ROLE_ORDER.filter((role) => byRole[role] > 0).map((role) => (
          <span>
            {byRole[role]} {role}
            {byRole[role] === 1 ? "" : "s"}
          </span>
        ))}
      </p>

      <ul class="card divide-y divide-line p-0">
        {people.map((person) => (
          <AccountRow
            person={person}
            grantable={grantableFor(viewer)}
            viewer={viewer}
            from="accounts"
          />
        ))}
      </ul>
    </Layout>
  );
};
