/**
 * Where the portal and the API live.
 *
 * Two constants with no dependencies, so that a module needing only a path --
 * the session cookie's scope, a download link -- does not have to import the
 * view layer to get one.
 */

/** Where the portal lives, and where its stylesheet and htmx are served. */
export const BASE = "/syndex";

/**
 * The API's own host.
 *
 * The portal is served from synthesizer-project.org and the API from
 * data.synthesizer-project.org, so a download link has to be absolute: /v1
 * on the portal's host reaches GitHub Pages, not this Worker.
 */
export const DATA_API = "https://data.synthesizer-project.org";
