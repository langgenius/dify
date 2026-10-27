import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { globSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { record } from '../document.js'

const sources = new Map<string, { identity: string; content: string }>()
const physicalPath = (file: string) => (file.startsWith('file:') ? fileURLToPath(file) : file)
export const isSource = (file: string) => file.endsWith('.openapi-source')

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))
    throw new Error(`${name} must be an array of non-empty strings`)
  return value as string[]
}

/** Source descriptors are authored inputs; the exported OpenAPI document stays in memory. */
export function inspectSource(content: string, fileName: string) {
  const file = physicalPath(fileName)
  const config = record(JSON.parse(content))
  const command = strings(config.command, 'command')
  if (!command.length) throw new Error('command must contain an executable')
  if (config.cwd !== undefined && typeof config.cwd !== 'string')
    throw new Error('cwd must be a string relative to the source descriptor')
  const cwd = resolve(dirname(file), config.cwd ?? '.')
  const inputs = strings(config.inputs, 'inputs')
  const exclude = strings(config.exclude ?? [], 'exclude')
  if (!inputs.length) throw new Error('inputs must declare the files used by the exporter')
  const env = strings(config.env ?? [], 'env')
  const timeout = config.timeoutMs ?? 60000
  if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error('timeoutMs must be a positive integer')
  const dependencies = new Set([file])
  const optional = new Set(
    strings(config.optionalInputs ?? [], 'optionalInputs').map((input) => resolve(cwd, input)),
  )
  for (const input of optional) {
    dependencies.add(input)
    dependencies.add(dirname(input))
  }
  for (const input of inputs) {
    const matches = globSync(input, {
      cwd,
      exclude: ['**/node_modules/**', '**/.venv/**', '**/.git/**', '**/__pycache__/**', ...exclude],
    })
    const matchedFiles = matches.filter((match) => statSync(resolve(cwd, match)).isFile())
    if (!matchedFiles.length) throw new Error(`No source input files match ${input} in ${cwd}`)
    const wildcard = [...input].findIndex((character) => '*?{['.includes(character))
    if (wildcard >= 0) {
      const prefix = input.slice(0, wildcard)
      const directory = prefix.endsWith('/') || prefix.endsWith('\\') ? prefix : dirname(prefix)
      dependencies.add(resolve(cwd, directory))
    }
    for (const match of matchedFiles) {
      const dependency = resolve(cwd, match)
      dependencies.add(dependency)
      // Watch parent directories too, so newly added and removed source files invalidate caches.
      dependencies.add(dirname(dependency))
    }
  }
  const files = [...dependencies].sort()
  const hash = createHash('sha256').update(content).update(cwd)
  for (const name of env) hash.update(JSON.stringify([name, process.env[name] ?? null]))
  for (const dependency of files) {
    const stat = statSync(dependency, { throwIfNoEntry: false })
    if (!stat && optional.has(dependency)) {
      hash.update(JSON.stringify([dependency, 'missing']))
      continue
    }
    if (!stat) throw new Error(`Source input disappeared: ${dependency}`)
    // Tiny optional configuration files can be rewritten within one filesystem
    // timestamp tick. Their contents must distinguish same-size rapid edits.
    if (optional.has(dependency) && stat.isFile()) {
      hash.update(dependency).update(readFileSync(dependency))
      continue
    }
    hash.update(
      JSON.stringify(
        stat.isDirectory()
          ? [dependency, 'directory']
          : [dependency, stat.mtimeMs, stat.ctimeMs, stat.size],
      ),
    )
  }
  return { command, cwd, timeout, dependencies: files, identity: hash.digest('hex') }
}

export function resolveDocument(content: string, fileName: string) {
  if (!isSource(fileName)) return { content, dependencies: [] as string[] }
  const source = inspectSource(content, fileName)
  const cached = sources.get(fileName)
  if (cached?.identity === source.identity)
    return { content: cached.content, dependencies: source.dependencies }
  const [executable, ...args] = source.command
  let output: string
  try {
    output = execFileSync(executable === 'node' ? process.execPath : executable!, args, {
      cwd: source.cwd,
      encoding: 'utf8',
      timeout: source.timeout,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(
      `OpenAPI export failed for ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  // Never cache empty/invalid stdout; exporter logs belong on stderr.
  const document = record(JSON.parse(output))
  if (typeof document.openapi !== 'string' || !document.paths)
    throw new Error(`OpenAPI exporter for ${fileName} must write an OpenAPI document to stdout`)
  sources.set(fileName, { identity: source.identity, content: output })
  return { content: output, dependencies: source.dependencies }
}

/** TS must know external inputs before transforming files, including on incremental builds. */
export function sourceProject(configFileName: unknown, options: unknown) {
  const config = options === undefined || options === null ? {} : record(options)
  const entries = strings(config.sources ?? [], 'options.sources')
  if (entries.length && typeof configFileName !== 'string')
    throw new Error('Command sources require a tsconfig file')
  const directory =
    typeof configFileName === 'string' && configFileName ? dirname(configFileName) : process.cwd()
  const registered = new Set(entries.map((entry) => resolve(directory, entry)))
  const watchedFiles = new Set<string>()
  const hash = createHash('sha256')
  for (const file of registered) {
    const source = inspectSource(readFileSync(file, 'utf8'), file)
    hash.update(source.identity)
    for (const dependency of source.dependencies) watchedFiles.add(dependency)
  }
  return { registered, configIdentity: hash.digest('hex'), watchedFiles: [...watchedFiles] }
}
