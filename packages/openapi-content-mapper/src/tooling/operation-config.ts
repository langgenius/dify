import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'es-module-lexer/js'
import { resolve } from 'import-meta-resolve'
import { operationConfigFile } from './runtime-config.js'

/** Inspect exports without executing application code. Re-exported modules stay static imports. */
export function operationConfig(fileName: string, kind: 'queries' | 'errors') {
  const file = operationConfigFile(fileName, kind)
  const dependencies = new Set<string>()
  const names = new Set<string>()
  function collect(module: string) {
    const path = module.startsWith('file:') ? fileURLToPath(module) : module
    if (dependencies.has(path)) return
    dependencies.add(path)
    const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    const [imports, exports] = parse(source)
    for (const entry of exports) names.add(entry.n)
    for (const entry of imports) {
      if (entry.d !== -1 || !entry.n) continue
      if (/^export\s*\*\s*from\b/.test(source.slice(entry.ss, entry.se)))
        collect(resolve(entry.n, pathToFileURL(path).href))
    }
  }
  if (file) collect(file)
  return { file, names, dependencies: [...dependencies] }
}
