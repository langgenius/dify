import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { runtimeConfigFile } from './runtime-config.js'
import { compileRuntime } from './transform.js'

type LoaderContext = {
  resourcePath: string
  resourceQuery: string
  getOptions: () => { runtime?: string; sidecars?: string }
  addDependency: (file: string) => void
  addMissingDependency?: (file: string) => void
}

type Compiled = {
  version: string
  render: ReturnType<typeof compileRuntime>
}

const cache = new Map<string, Compiled>()
const namespaceFile = createRequire(import.meta.url).resolve(
  '@dify/openapi-content-mapper/namespace',
)

/** Namespace modules use an empty resource so bundlers don't retain a spec copy per module. */
export default function openapiLoader(this: LoaderContext): string {
  const query = new URLSearchParams(this.resourceQuery)
  const document = query.get('openapi-document')
  const fileName = document ?? this.resourcePath
  this.addDependency(fileName)
  const { runtime, sidecars: logicalDocument } = this.getOptions()
  const sidecarFileName = logicalDocument ? resolve(dirname(fileName), logicalDocument) : fileName
  const config = runtime ? resolve(dirname(fileName), runtime) : runtimeConfigFile(fileName)
  if (config) this.addDependency(config)
  const runtimeModule = config
    ? `./${relative(dirname(this.resourcePath), config).replaceAll('\\', '/')}`
    : undefined
  const namespaceResource = `./${relative(dirname(this.resourcePath), namespaceFile).replaceAll('\\', '/')}`
  const namespace = `${namespaceResource}?openapi-document=${encodeURIComponent(fileName)}`
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
  let compiled = cache.get(key)
  const version = versionOf(compiled?.render.dependencies ?? [])
  if (!compiled || compiled.version !== version) {
    const source = readFileSync(fileName, 'utf8')
    compiled = {
      version,
      render: compileRuntime(
        source,
        fileName,
        runtimeModule,
        namespace,
        (file) => `./${relative(dirname(this.resourcePath), file).replaceAll('\\', '/')}`,
        sidecarFileName,
      ),
    }
    compiled.version = versionOf(compiled.render.dependencies)
    cache.set(key, compiled)
  }
  for (const file of new Set([...sidecars, ...compiled.render.dependencies])) {
    if (existsSync(file)) this.addDependency(file)
    else this.addMissingDependency?.(file)
  }
  const isQuery = query.has('openapi-errors') ? 'errors' : query.has('openapi-query')
  const path = query.get(
    isQuery === 'errors' ? 'openapi-errors' : isQuery ? 'openapi-query' : 'openapi-router',
  )
  return compiled.render(path === null ? undefined : JSON.parse(path), isQuery)
}
