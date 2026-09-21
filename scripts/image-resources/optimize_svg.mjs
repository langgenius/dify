import { readFileSync } from 'node:fs'
import { optimize } from 'svgo'

// An explicit allowlist: never enable preset-default here. Preserve geometry,
// styles, IDs, definitions, namespaces, and references, including external ones.
const config = {
  plugins: ['removeComments', 'sortAttrs'],
  js2svg: { pretty: false },
}

try {
  const result = optimize(readFileSync(0, 'utf8'), config)
  process.stdout.write(result.data)
}
catch (error) {
  process.stderr.write(`SVGO failed: ${error.message}\n`)
  process.exitCode = 1
}
