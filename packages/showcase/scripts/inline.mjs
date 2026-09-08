/**
 * Folds the Vite build into one self-contained HTML file so the deck can be
 * opened straight from disk (module scripts loaded over file:// are blocked by
 * browsers, inline ones are not) or dropped onto any static host.
 */

import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const output = 'six-months-in-the-open.html'

const html = await readFile(path.join(distDir, 'index.html'), 'utf8')

async function inline(source, pattern, wrap) {
  let result = source
  for (const match of source.matchAll(pattern)) {
    const [tag, assetPath] = match
    const asset = await readFile(path.join(distDir, assetPath.replace(/^\.?\//, '')), 'utf8')
    // A replacer function: a plain string replacement would expand `$&`-style patterns inside the bundle.
    result = result.replace(tag, () => wrap(asset))
  }
  return result
}

let inlined = await inline(
  html,
  /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
  (asset) =>
    `<script type="module">${asset.replaceAll('</script', String.raw`<\/script`)}</script>`,
)
inlined = await inline(
  inlined,
  /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
  (asset) => `<style>${asset.replaceAll('</style', String.raw`<\/style`)}</style>`,
)

await writeFile(path.join(distDir, output), inlined)
console.log(`dist/${output} (${(Buffer.byteLength(inlined) / 1024).toFixed(0)} kB)`)
