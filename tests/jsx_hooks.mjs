/**
 * Module hooks that let plain `node` import the portal's JSX.
 *
 * Wrangler bundles the Worker with esbuild, so JSX costs the deployed code no
 * extra build step, but Node itself cannot parse a .jsx file. Rather than
 * bundling before every test run, the tests register these hooks and esbuild
 * transforms each file as it is imported, honouring the @jsxImportSource
 * pragma at the top of it exactly as the real build does.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";

/**
 * Transform a .jsx module on its way in.
 *
 * @param {string} url URL of the module being loaded.
 * @param {object} context Load context from Node.
 * @param {Function} nextLoad The default loader.
 * @returns {object} The module source Node should evaluate.
 */
export function load(url, context, nextLoad) {
  if (!url.endsWith(".jsx")) {
    return nextLoad(url, context);
  }

  const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), {
    loader: "jsx",
    format: "esm",
    sourcefile: url,
  });
  return { format: "module", source: code, shortCircuit: true };
}
