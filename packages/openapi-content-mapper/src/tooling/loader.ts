import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { loadOperationConfigs } from './operation-config.js'
import { runtimeConfigFile } from './runtime-config.js'
import { compileRuntime } from './transform.js'

type LoaderContext = {
  resourcePath: string
  resourceQuery: string
  getOptions: () => { runtime?: string; sidecars?: string }
  addDependency: (file: string) => void
  addContextDependency?: (directory: string) => void
  addMissingDependency?: (file: string) => void
  async: () => (error: Error | null, source?: string) => void
  getResolve: (options: {
    dependencyType: string
  }) => (context: string, request: string) => Promise<string | false>
}

type Compiled = {
  version: string
  render: ReturnType<typeof compileRuntime>
}

const cache = new Map<string, Promise<Compiled>>()
const namespaceFile = createRequire(import.meta.url).resolve(
  '@dify/openapi-content-mapper/namespace',
)

/** Namespace modules use an empty resource so bundlers don't retain a spec copy per module. */
export default function openapiLoader(this: LoaderContext): void {
  const done = this.async()
  render.call(this).then(
    (source) => done(null, source),
    (error: Error) => done(error),
  )
}

async function render(this: LoaderContext): Promise<string> {
  const query = new URLSearchParams(this.resourceQuery)
  const document = query.get('openapi-document')
  const fileName = document ?? this.resourcePath
  this.addDependency(fileName)
  const options = this.getOptions()
  const runtime = query.get('openapi-runtime') ?? options.runtime
  const logicalDocument = query.get('openapi-sidecars') ?? options.sidecars
  const sidecarFileName = logicalDocument ? resolve(dirname(fileName), logicalDocument) : fileName
  const config = runtime ? resolve(dirname(fileName), runtime) : runtimeConfigFile(fileName)
  if (config) this.addDependency(config)
  const runtimeModule = config
    ? `./${relative(dirname(this.resourcePath), config).replaceAll('\\', '/')}`
    : undefined
  const namespaceResource = `./${relative(dirname(this.resourcePath), namespaceFile).replaceAll('\\', '/')}`
  // Carry document-specific bindings through the shared namespace resource. A single
  // loader rule can then serve documents with independent transports and policies.
  const bindings = new URLSearchParams({ 'openapi-document': fileName })
  if (config) bindings.set('openapi-runtime', config)
  if (logicalDocument) bindings.set('openapi-sidecars', sidecarFileName)
  const namespace = `${namespaceResource}?${bindings}`
  // Documents can live in a workspace package that has no SDK dependency.
  // Resolve the API and query namespaces from the SDK resource.
  if (!document) return `export * from ${JSON.stringify(namespace)};\n`
  const key = JSON.stringify([fileName, sidecarFileName, runtimeModule, namespaceResource])
  const sidecars = [`${sidecarFileName}.queries.ts`, `${sidecarFileName}.errors.ts`]
  const versionOf = (dependencies: string[]) =>
    [...new Set([fileName, ...sidecars, ...dependencies])]
      .map((file) => {
        if (!existsSync(file)) return `${file}:missing`
        const stat = statSync(file)
        return `${file}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
      })
      .join('\n')
  const cached = cache.get(key)
  let compiled = cached ? await cached : undefined
  const version = versionOf(compiled?.render.dependencies ?? [])
  if (!compiled || compiled.version !== version) {
    const pending = (async () => {
      const source = readFileSync(fileName, 'utf8')
      const resolveModule = this.getResolve({ dependencyType: 'esm' })
      const configs = await loadOperationConfigs(sidecarFileName, async (specifier, importer) => {
        const resolved = await resolveModule(dirname(importer), specifier)
        if (!resolved)
          throw new Error(`Cannot inspect sidecar re-export ${specifier} from ${importer}`)
        return resolved
      })
      const render = compileRuntime(
        source,
        fileName,
        runtimeModule,
        namespace,
        (file) => `./${relative(dirname(this.resourcePath), file).replaceAll('\\', '/')}`,
        sidecarFileName,
        configs,
      )
      return { version: versionOf(render.dependencies), render }
    })()
    // Concurrent namespace loaders share both resolution and document compilation.
    cache.set(key, pending)
    try {
      compiled = await pending
    } catch (error) {
      if (cache.get(key) === pending) cache.delete(key)
      throw error
    }
  }
  for (const file of new Set([...sidecars, ...compiled.render.dependencies])) {
    if (existsSync(file)) {
      if (statSync(file).isDirectory()) this.addContextDependency?.(file)
      else this.addDependency(file)
    } else this.addMissingDependency?.(file)
  }
  const isQuery = query.has('openapi-errors') ? 'errors' : query.has('openapi-query')
  const path = query.get(
    isQuery === 'errors' ? 'openapi-errors' : isQuery ? 'openapi-query' : 'openapi-router',
  )
  return compiled.render(path === null ? undefined : JSON.parse(path), isQuery)
}
