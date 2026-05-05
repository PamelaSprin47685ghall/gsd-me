import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

/**
 * Resolve an @gsd/* workspace package to a file:// URL using GSD_PKG_ROOT.
 * Under pi, GSD_PKG_ROOT is set to gsd-pi's install root. Workspace packages
 * are linked at node_modules/@gsd/<name> → packages/<name>. Native ESM import()
 * can't resolve @gsd/* scoped packages from outside gsd-pi, so we resolve the
 * physical path via GSD_PKG_ROOT.
 */
export function gsdPkgURL(name) {
  const root = process.env.GSD_PKG_ROOT
  if (!root)
    throw new Error(`GSD_PKG_ROOT not set — cannot resolve @gsd/${name}`)
  return pathToFileURL(join(root, 'node_modules/@gsd', name, 'dist/index.js'))
    .href
}

/**
 * Resolve @sinclair/typebox ESM entry via GSD_PKG_ROOT.
 * Same rationale: it lives inside gsd-pi's node_modules tree.
 */
export function typeboxURL() {
  const root = process.env.GSD_PKG_ROOT
  if (!root)
    throw new Error('GSD_PKG_ROOT not set — cannot resolve @sinclair/typebox')
  return pathToFileURL(
    join(root, 'node_modules/@sinclair/typebox/build/esm/index.mjs'),
  ).href
}
