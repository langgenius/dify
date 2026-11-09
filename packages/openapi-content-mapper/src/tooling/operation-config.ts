import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'es-module-lexer/js'
import { resolve } from 'import-meta-resolve'
import { operationConfigFile } from './runtime-config.js'

type ModuleReference = { specifier: string; importer: string }
type OperationConfig = { file: string | undefined; names: Set<string>; dependencies: string[] }
export type OperationConfigs = { queries: OperationConfig; errors: OperationConfig }

/** Share inspection between synchronous Node hooks and asynchronous bundler resolvers. */
function* inspectOperationConfig(
  fileName: string,
  kind: 'queries' | 'errors',
): Generator<ModuleReference, OperationConfig, string> {
  const file = operationConfigFile(fileName, kind)
  const dependencies = new Set<string>()
  const names = new Set<string>()
  function* collect(module: string): Generator<ModuleReference, void, string> {
    const path = module.startsWith('file:') ? fileURLToPath(module) : module
    if (dependencies.has(path)) return
    dependencies.add(path)
    const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    const [imports, exports] = parse(source)
    for (const entry of exports) names.add(entry.n)
    for (const entry of imports) {
      if (entry.d !== -1 || !entry.n) continue
      if (/^export\s*\*\s*from\b/.test(source.slice(entry.ss, entry.se)))
        yield* collect(yield { specifier: entry.n, importer: path })
    }
  }
  if (file) yield* collect(file)
  return { file, names, dependencies: [...dependencies] }
}

/** Inspect exports without executing application code. Node retains native ESM resolution. */
export function operationConfig(fileName: string, kind: 'queries' | 'errors'): OperationConfig {
  const inspection = inspectOperationConfig(fileName, kind)
  let next = inspection.next()
  while (!next.done) {
    const { specifier, importer } = next.value
    next = inspection.next(resolve(specifier, pathToFileURL(importer).href))
  }
  return next.value
}

/** Resolve star re-exports exactly as the consuming build resolves its ordinary imports. */
export async function loadOperationConfigs(
  fileName: string,
  resolveModule: (specifier: string, importer: string) => Promise<string>,
): Promise<OperationConfigs> {
  async function load(kind: 'queries' | 'errors') {
    const inspection = inspectOperationConfig(fileName, kind)
    let next = inspection.next()
    while (!next.done) {
      const { specifier, importer } = next.value
      next = inspection.next(await resolveModule(specifier, importer))
    }
    return next.value
  }
  const [queries, errors] = await Promise.all([load('queries'), load('errors')])
  return { queries, errors }
}
