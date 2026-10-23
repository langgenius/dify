import { basename, dirname, relative, resolve } from 'node:path'
import { compileRuntime, runtimeConfigFile } from './transform.js'

type LoaderContext = {
  resourcePath: string
  resourceQuery: string
  getOptions: () => { runtime?: string }
  addDependency: (file: string) => void
}

const cache = new Map<string, { content: string; render: ReturnType<typeof compileRuntime> }>()

/** Webpack and Turbopack retain each router namespace as a distinct query module. */
export default function openapiLoader(this: LoaderContext, content: string): string {
  const { runtime } = this.getOptions()
  const directory = dirname(this.resourcePath)
  const config = runtime ? resolve(directory, runtime) : runtimeConfigFile(this.resourcePath)
  if (config) this.addDependency(config)
  const runtimeModule = config
    ? `./${relative(directory, config).replaceAll('\\', '/')}`
    : undefined
  const key = JSON.stringify([this.resourcePath, runtimeModule])
  let compiled = cache.get(key)
  if (!compiled || compiled.content !== content) {
    compiled = {
      content,
      render: compileRuntime(content, `./${basename(this.resourcePath)}`, runtimeModule),
    }
    cache.set(key, compiled)
  }
  const query = new URLSearchParams(this.resourceQuery)
  const isQuery = query.has('openapi-query')
  const path = query.get(isQuery ? 'openapi-query' : 'openapi-router')
  return compiled.render(path === null ? undefined : JSON.parse(path), isQuery)
}
