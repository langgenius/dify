import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { record } from '../document.js'

const sources = new Map<string, { identity: string; content: string }>()
const physicalPath = (file: string) => (file.startsWith('file:') ? fileURLToPath(file) : file)
export const isTypeSource = (file: string) => file.endsWith('.openapi-types')
export const isSource = (file: string) => file.endsWith('.openapi-source') || isTypeSource(file)

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))
    throw new Error(`${name} must be an array of non-empty strings`)
  return value as string[]
}

type SourceConfig = {
  config: Record<string, unknown>
  cwd: string
  descriptors: Map<string, string>
}

/** Resolve extends and cwd relative to the descriptor that defines them. */
function sourceConfig(content: string, file: string, parents = new Set<string>()): SourceConfig {
  if (parents.has(file)) throw new Error(`Circular source descriptor inheritance: ${file}`)
  parents.add(file)
  const own = record(JSON.parse(content))
  if (own.cwd !== undefined && typeof own.cwd !== 'string')
    throw new Error('cwd must be a string relative to the source descriptor')
  let inherited: SourceConfig = { config: {}, cwd: dirname(file), descriptors: new Map() }
  if (own.extends !== undefined) {
    if (typeof own.extends !== 'string' || !own.extends)
      throw new Error('extends must be a non-empty relative descriptor path')
    const parent = resolve(dirname(file), own.extends)
    inherited = sourceConfig(readFileSync(parent, 'utf8'), parent, parents)
  }
  inherited.descriptors.set(file, content)
  return {
    config: { ...inherited.config, ...own },
    cwd: own.cwd === undefined ? inherited.cwd : resolve(dirname(file), own.cwd),
    descriptors: inherited.descriptors,
  }
}

/** The directory to watch for files newly matching a glob. */
function globDirectory(pattern: string, cwd: string): string | undefined {
  const wildcard = pattern.search(/[*?{[]/)
  if (wildcard < 0) return undefined
  const prefix = pattern.slice(0, wildcard)
  return resolve(cwd, /[/\\]$/.test(prefix) ? prefix : dirname(prefix))
}

type InputSnapshot = { dependencies: string[]; identity: string }

function inspectInputs(config: Record<string, unknown>, cwd: string): InputSnapshot {
  const inputs = strings(config.inputs, 'inputs')
  const exclude = strings(config.exclude ?? [], 'exclude')
  if (!inputs.length) throw new Error('inputs must declare the files used by the exporter')
  const env = strings(config.env ?? [], 'env')
  const dependencies = new Set<string>()
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
    const directory = globDirectory(input, cwd)
    if (directory) dependencies.add(directory)
    for (const match of matchedFiles) {
      const dependency = resolve(cwd, match)
      dependencies.add(dependency)
      // Watch parent directories too, so newly added and removed source files invalidate caches.
      dependencies.add(dirname(dependency))
    }
  }
  const files = [...dependencies].sort()
  const hash = createHash('sha256')
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
  return { dependencies: files, identity: hash.digest('hex') }
}

/** Source descriptors are authored inputs; the exported OpenAPI document stays in memory. */
export function inspectSource(
  content: string,
  fileName: string,
  inputSnapshots?: Map<string, InputSnapshot>,
) {
  const file = physicalPath(fileName)
  const { config, cwd, descriptors } = sourceConfig(content, file)
  const command = strings(config.command, 'command')
  if (!command.length) throw new Error('command must contain an executable')
  const args = strings(config.args ?? [], 'args')
  const timeout = config.timeoutMs ?? 60000
  if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error('timeoutMs must be a positive integer')
  // This cache lives for one project registration only. Modules sharing input
  // globs reuse the scan, while every project refresh reads fresh filesystem state.
  const key = JSON.stringify([
    cwd,
    config.inputs,
    config.exclude,
    config.optionalInputs,
    config.env,
  ])
  let inputs = inputSnapshots?.get(key)
  if (!inputs) {
    inputs = inspectInputs(config, cwd)
    inputSnapshots?.set(key, inputs)
  }
  const hash = createHash('sha256').update(content).update(cwd).update(inputs.identity)
  for (const [descriptor, text] of descriptors) hash.update(descriptor).update(text)
  return {
    command: [...command, ...args],
    cwd,
    timeout,
    dependencies: [...new Set([...descriptors.keys(), ...inputs.dependencies])].sort(),
    identity: hash.digest('hex'),
  }
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
  if (isTypeSource(fileName)) {
    if (typeof document.typescript !== 'string' || !document.typescript.trim())
      throw new Error(
        `Type exporter for ${fileName} must write a non-empty typescript string in JSON`,
      )
  } else if (typeof document.openapi !== 'string' || !document.paths)
    throw new Error(`OpenAPI exporter for ${fileName} must write an OpenAPI document to stdout`)
  sources.set(fileName, { identity: source.identity, content: output })
  return { content: output, dependencies: source.dependencies }
}

/** TS must know external inputs before transforming files, including on incremental builds. */
export function sourceProject(
  configFileName: unknown,
  options: unknown,
  bundledDirectory?: string,
) {
  const config = options === undefined || options === null ? {} : record(options)
  const entries = strings(config.sources ?? [], 'options.sources')
  if (entries.length && typeof configFileName !== 'string')
    throw new Error('Command sources require a tsconfig file')
  const directory =
    typeof configFileName === 'string' && configFileName ? dirname(configFileName) : process.cwd()
  const registered = new Set<string>()
  const watchedFiles = new Set<string>()
  // Workspace-only contract sources belong to this package, never the consumer.
  // The published SDK has no contracts directory and needs no repository inputs.
  if (bundledDirectory && existsSync(bundledDirectory)) {
    watchedFiles.add(bundledDirectory)
    for (const file of globSync('**/*.openapi-types', { cwd: bundledDirectory }).sort()) {
      registered.add(resolve(bundledDirectory, file))
      let parent = dirname(resolve(bundledDirectory, file))
      while (parent !== bundledDirectory && parent !== dirname(parent)) {
        watchedFiles.add(parent)
        parent = dirname(parent)
      }
    }
  }
  for (const entry of entries) {
    const base = globDirectory(entry, directory)
    if (base) {
      const matches = globSync(entry, { cwd: directory }).sort()
      if (!matches.length) throw new Error(`No source descriptors match ${entry}`)
      for (const match of matches) registered.add(resolve(directory, match))
      watchedFiles.add(base)
      for (const match of matches) {
        let parent = dirname(resolve(directory, match))
        while (parent !== base && parent !== dirname(parent)) {
          watchedFiles.add(parent)
          parent = dirname(parent)
        }
      }
    } else registered.add(resolve(directory, entry))
  }
  const hash = createHash('sha256')
  const inputSnapshots = new Map<string, InputSnapshot>()
  for (const file of registered) {
    const source = inspectSource(readFileSync(file, 'utf8'), file, inputSnapshots)
    hash.update(source.identity)
    for (const dependency of source.dependencies) watchedFiles.add(dependency)
  }
  return { registered, configIdentity: hash.digest('hex'), watchedFiles: [...watchedFiles] }
}
