import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

/** Namespace modules use an empty resource so bundlers don't retain a spec copy per module. */
export default function openapiLoader(this: LoaderContext, content: string): string {
  const query = new URLSearchParams(this.resourceQuery)
  const document = query.get('openapi-document')
  const fileName = document ?? this.resourcePath
  this.addDependency(fileName)
  const { runtime } = this.getOptions()
  const config = runtime ? resolve(dirname(fileName), runtime) : runtimeConfigFile(fileName)
  if (config) this.addDependency(config)
  const key = JSON.stringify([fileName, config])
  const stat = statSync(fileName)
  const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
  let compiled = cache.get(key)
  if (!compiled || compiled.version !== version || (!document && compiled.content !== content)) {
    const source = document ? readFileSync(fileName, 'utf8') : content
    const namespace = `@dify/openapi-inference/namespace?openapi-document=${encodeURIComponent(fileName)}`
    compiled = {
      version,
      content: source,
      render: compileRuntime(source, fileName, config, namespace),
    }
    cache.set(key, compiled)
  }
  const isQuery = query.has('openapi-query')
  const path = query.get(isQuery ? 'openapi-query' : 'openapi-router')
  return compiled.render(path === null ? undefined : JSON.parse(path), isQuery)
}
