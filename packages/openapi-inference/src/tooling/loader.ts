import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { compileRuntime, runtimeConfigFile } from './transform.js'

type LoaderContext = {
  resourcePath: string
  resourceQuery: string
  getOptions: () => { runtime?: string }
  addDependency: (file: string) => void
}

type Compiled = {
  version: string
  content: string
  render: ReturnType<typeof compileRuntime>
}

const cache = new Map<string, Compiled>()
const namespaceFile = createRequire(import.meta.url).resolve('@dify/openapi-inference/namespace')

/** Namespace modules use an empty resource so bundlers don't retain a spec copy per module. */
export default function openapiLoader(this: LoaderContext, content: string): string {
  const query = new URLSearchParams(this.resourceQuery)
  const document = query.get('openapi-document')
  const fileName = document ?? this.resourcePath
  this.addDependency(fileName)
  const { runtime } = this.getOptions()
  const config = runtime ? resolve(dirname(fileName), runtime) : runtimeConfigFile(fileName)
  if (config) this.addDependency(config)
  const runtimeModule = config
    ? `./${relative(dirname(this.resourcePath), config).replaceAll('\\', '/')}`
    : undefined
  const namespaceResource = `./${relative(dirname(this.resourcePath), namespaceFile).replaceAll('\\', '/')}`
  const namespace = `${namespaceResource}?openapi-document=${encodeURIComponent(fileName)}`
  const key = JSON.stringify([fileName, runtimeModule, namespaceResource])
  const stat = statSync(fileName)
  const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
  let compiled = cache.get(key)
  if (!compiled || compiled.version !== version || (!document && compiled.content !== content)) {
    const source = document ? readFileSync(fileName, 'utf8') : content
    compiled = {
      version,
      content: source,
      render: compileRuntime(source, fileName, runtimeModule, namespace),
    }
    cache.set(key, compiled)
  }
  const isQuery = query.has('openapi-query')
  const path = query.get(isQuery ? 'openapi-query' : 'openapi-router')
  return compiled.render(path === null ? undefined : JSON.parse(path), isQuery)
}
