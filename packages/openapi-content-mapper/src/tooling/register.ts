import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { errorsQuery, queryQuery, routerQuery } from './router.js'
import { compileRuntime } from './transform.js'

const cache = new Map<string, ReturnType<typeof compileRuntime>>()

// JSON uses a .openapi entry; YAML uses .yaml or .yml.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.includes(routerQuery) ||
      specifier.includes(queryQuery) ||
      specifier.includes(errorsQuery)
    )
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
    if (
      (specifier.startsWith('file:') ||
        (context.parentURL?.startsWith('file:') &&
          (specifier.startsWith('.') || specifier.startsWith('/')))) &&
      /\.(?:openapi|openapi-source)$/.test(specifier)
    )
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (
      url.startsWith('file:') &&
      /\.(?:openapi-source|openapi|ya?ml)$/.test(new URL(url).pathname)
    ) {
      const sourceUrl = new URL(url)
      const isQuery = sourceUrl.searchParams.has('openapi-errors')
        ? 'errors'
        : sourceUrl.searchParams.has('openapi-query')
      const encoded = sourceUrl.searchParams.get(
        isQuery === 'errors' ? 'openapi-errors' : isQuery ? 'openapi-query' : 'openapi-router',
      )
      sourceUrl.search = ''
      const path = fileURLToPath(sourceUrl)
      let render = cache.get(path)
      if (!render) {
        render = compileRuntime(readFileSync(path, 'utf8'), sourceUrl.href)
        cache.set(path, render)
      }
      return {
        format: 'module',
        source: render(encoded === null ? undefined : JSON.parse(encoded), isQuery),
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})
