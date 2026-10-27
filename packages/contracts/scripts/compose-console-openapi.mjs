import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

export function loadConsoleDocument(root = resolve(import.meta.dirname, '..')) {
  const community = JSON.parse(
    execFileSync('uv', ['run', '--project', 'api', 'api/dev/cached_console_openapi.py'], {
      cwd: resolve(root, '../..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 100000,
    }),
  )
  const snapshots = [
    ['enterprise', 'generated/enterprise/openapi.gen.json'],
    ['appDeploy', 'generated/enterprise-app-deploy/openapi.gen.json'],
  ].map(([name, path]) => ({
    name,
    document: JSON.parse(readFileSync(resolve(root, path), 'utf8')),
  }))
  return composeConsoleDocuments([
    { name: 'console', document: community.console },
    { name: 'fast', document: community.fast, stripPrefix: '/console/api' },
    ...snapshots,
  ])
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(loadConsoleDocument())}\n`)
