import fs from 'node:fs'
import path from 'node:path'

const targets = process.argv.slice(2)

if (!targets.length)
  throw new Error('Usage: node scripts/patch-orpc-v2-generated.mjs <file-or-directory> [...]')

function* tsFiles(target) {
  if (!fs.existsSync(target))
    return

  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.ts'))
      yield target
    return
  }

  if (!stat.isDirectory())
    return

  for (const entry of fs.readdirSync(target)) {
    yield* tsFiles(path.join(target, entry))
  }
}

for (const target of targets) {
  for (const filePath of tsFiles(target)) {
    const source = fs.readFileSync(filePath, 'utf8')
    if (!source.includes('.route(') && !source.includes('.$route(') && !source.includes('openapi('))
      continue

    let output = source
      .replace(/\.\$?route\((\{[\s\S]*?\})\)/g, '.meta(openapi($1))')

    if (output.includes('openapi(') && !output.includes('from \'@orpc/openapi\'')) {
      output = output.replace(
        /(import\s+\{[^}]*\boc\b[^}]*\}\s+from '@orpc\/contract';?\n)/,
        '$1import { openapi } from \'@orpc/openapi\'\n',
      )
    }

    if (output !== source)
      fs.writeFileSync(filePath, output)
  }
}
