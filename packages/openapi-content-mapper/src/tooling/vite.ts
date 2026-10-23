import type { Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { queryQuery, routerQuery } from './router.js'
import { compileRuntime } from './transform.js'

export function openapi(
  options: {
    include?: RegExp
    /** Absolute path or import specifier of a module exporting a default RuntimeConfig. */
    runtime?: (fileName: string) => string | undefined
  } = {},
): Plugin {
  const include = options.include ?? /\.(openapi|ya?ml)$/
  const cache = new Map<string, ReturnType<typeof compileRuntime>>()
  const realPaths = new Map<string, string>()
  let root = process.cwd()
  return {
    name: 'openapi-content-mapper',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    async resolveId(source, importer) {
      const marker = source.includes(queryQuery) ? queryQuery : routerQuery
      const offset = source.indexOf(marker)
      const suffix = offset < 0 ? '' : source.slice(offset)
      const bare = offset < 0 ? source : source.slice(0, offset)
      include.lastIndex = 0
      if (bare.includes('?') || !include.test(bare)) return
      if (bare.startsWith('/@fs/')) return bare.slice(4) + suffix
      // Keep the logical extension when .openapi is a symlink to a .json file.
      // Otherwise Vite realpaths it and its built-in JSON plugin takes over.
      if (bare.endsWith('.openapi')) {
        const candidate =
          bare.startsWith('.') && importer
            ? resolve(dirname(importer.split('?')[0]!), bare)
            : bare.startsWith('/')
              ? existsSync(bare)
                ? bare
                : resolve(root, `.${bare}`)
              : undefined
        if (candidate && existsSync(candidate)) return candidate + suffix
      }
      if (suffix) {
        // Browser URLs are root-relative, while build imports use filesystem paths.
        const resolved = await this.resolve(bare, importer, { skipSelf: true })
        if (resolved) return resolved.id + suffix
      }
    },
    async load(id) {
      const isQuery = id.includes(queryQuery)
      const [fileName, encoded] = id.split(isQuery ? queryQuery : routerQuery)
      if (!fileName) return
      // Leave ?raw / ?url imports to Vite.
      include.lastIndex = 0
      if (fileName.includes('?') || !include.test(fileName)) return
      this.addWatchFile(fileName)
      let render = cache.get(fileName)
      if (!render) {
        render = compileRuntime(
          await readFile(fileName, 'utf8'),
          fileName,
          options.runtime?.(fileName),
        )
        cache.set(fileName, render)
        const physical = await realpath(fileName)
        realPaths.set(fileName, physical)
        this.addWatchFile(physical)
      }
      return {
        code: render(
          encoded === undefined ? undefined : JSON.parse(decodeURIComponent(encoded)),
          isQuery,
        ),
        map: null,
      }
    },
    watchChange() {
      cache.clear()
    },
    handleHotUpdate(context) {
      const affected = [...realPaths].filter(
        ([file, physical]) => file === context.file || physical === context.file,
      )
      if (!affected.length) return
      const modules = new Set(context.modules)
      for (const [file] of affected) {
        cache.delete(file)
        for (const module of context.server.moduleGraph.getModulesByFile(file) ?? []) {
          context.server.moduleGraph.invalidateModule(module)
          modules.add(module)
        }
      }
      return [...modules]
    },
  }
}
