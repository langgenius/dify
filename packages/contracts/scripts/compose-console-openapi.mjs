import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])

/** Namespace local components so independently versioned specifications cannot overwrite each other. */
export function composeConsoleDocuments(sources) {
  const result = {
    openapi: '3.1.0',
    info: { title: 'Dify Console client', version: '1' },
    paths: {},
    components: {},
  }
  for (const { name, document, stripPrefix = '' } of sources) {
    if (!/^3\.[01]\./.test(document.openapi) || !document.paths)
      throw new Error(`Invalid OpenAPI source: ${name}`)
    function rewrite(value) {
      if (Array.isArray(value)) return value.map(rewrite)
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          if (key === '$ref') {
            if (typeof child !== 'string' || !child.startsWith('#/components/'))
              throw new Error(`Unsupported reference in ${name}: ${child}`)
            return [key, child.replace(/^(#\/components\/[^/]+\/)/, `$1${name}_`)]
          }
          return [key, rewrite(child)]
        }),
      )
    }
    for (const [group, components] of Object.entries(document.components ?? {})) {
      const target = (result.components[group] ??= {})
      for (const [key, component] of Object.entries(components)) {
        const qualified = `${name}_${key}`
        if (Object.hasOwn(target, qualified)) throw new Error(`Duplicate component: ${qualified}`)
        target[qualified] = rewrite(component)
      }
    }
    for (const [rawPath, rawItem] of Object.entries(document.paths)) {
      const path =
        stripPrefix && rawPath.startsWith(`${stripPrefix}/`)
          ? rawPath.slice(stripPrefix.length)
          : rawPath
      const item = rewrite(rawItem)
      if (Object.hasOwn(result.paths, path)) throw new Error(`Duplicate Console path: ${path}`)
      for (const [method, operation] of Object.entries(item)) {
        if (!methods.has(method)) continue
        // Redirect-only browser navigation endpoints are not oRPC procedures.
        if (!Object.keys(operation.responses ?? {}).some((status) => /^2\d\d$/.test(status))) {
          delete item[method]
          continue
        }
        operation.operationId = `${name}_${method}_${path}`
        // Preserve source-level servers when operations do not override them.
        if (!operation.servers && !item.servers && document.servers)
          operation.servers = document.servers
      }
      if (Object.keys(item).some((method) => methods.has(method))) result.paths[path] = item
    }
  }
  return result
}

export function composeConsoleFile(
  root = resolve(import.meta.dirname, '..'),
  output = resolve(root, 'openapi/console-client-openapi.json'),
) {
  const sources = [
    ['console', 'openapi/console-openapi.json'],
    ['fast', 'openapi/fastopenapi-console-openapi.json', '/console/api'],
    ['enterprise', 'generated/enterprise/openapi.gen.json'],
    ['appDeploy', 'generated/enterprise-app-deploy/openapi.gen.json'],
  ].map(([name, path, stripPrefix]) => ({
    name,
    document: JSON.parse(readFileSync(resolve(root, path), 'utf8')),
    stripPrefix,
  }))
  const document = composeConsoleDocuments(sources)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(document)}\n`)
  return document
}

if (import.meta.main) composeConsoleFile()
