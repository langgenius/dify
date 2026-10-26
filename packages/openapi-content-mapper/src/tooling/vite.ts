import type { Plugin, ViteDevServer } from 'vite'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { loadOperationConfigs } from './operation-config.js'
import { errorsQuery, moduleQuery, queryQuery } from './router.js'
import { compileRuntime } from './transform.js'

export function openapi(
  options: {
    include?: RegExp
    /** Absolute path or import specifier of a module exporting a default RuntimeConfig. */
    runtime?: (fileName: string) => string | undefined
  } = {},
): Plugin {
  const include = options.include ?? /\.(openapi-source|openapi|ya?ml)$/
  const cache = new Map<string, ReturnType<typeof compileRuntime>>()
  const realPaths = new Map<string, string>()
  let root = process.cwd()
  let server: ViteDevServer | undefined
  let groupErrors = false
  const dependencies = new Map<string, string[]>()
  return {
    name: 'openapi-content-mapper',
    enforce: 'pre',
    configureServer(value) {
      server = value
    },
    configResolved(config) {
      root = config.root
    },
    async resolveId(source, importer) {
      const marker = moduleQuery(source)
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
      const marker = moduleQuery(id)
      const isQuery = marker === errorsQuery ? 'errors' : marker === queryQuery
      const [fileName, encoded] = id.split(marker)
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
          fileName,
          undefined,
          fileName,
          await loadOperationConfigs(fileName, async (specifier, importer) => {
            const resolved = await this.resolve(specifier, importer, { skipSelf: true })
            if (!resolved || resolved.external)
              throw new Error(`Cannot inspect sidecar re-export ${specifier} from ${importer}`)
            return resolved.id
          }),
        )
        cache.set(fileName, render)
        const physical = await realpath(fileName)
        realPaths.set(fileName, physical)
        this.addWatchFile(physical)
      }
      dependencies.set(fileName, render.dependencies)
      for (const dependency of render.dependencies) {
        const stat = statSync(dependency, { throwIfNoEntry: false })
        // Vite treats addWatchFile as an implicit import. Missing optional
        // inputs and directories belong to the watcher, not its module graph.
        if (server && (!stat || stat.isDirectory())) server.watcher.add(dependency)
        else this.addWatchFile(dependency)
      }
      server?.watcher.add([`${fileName}.queries.ts`, `${fileName}.errors.ts`])
      return {
        code: render(
          encoded === undefined ? undefined : JSON.parse(decodeURIComponent(encoded)),
          isQuery,
        ),
        // Generated namespaces have no source positions in the specification.
        // Stop downstream transforms from embedding the full document in every module's map.
        map: { mappings: '' },
      }
    },
    options(input) {
      // Rolldown requires extensible entry exports to group entries without moving dependencies.
      groupErrors =
        input.preserveEntrySignatures === false ||
        input.preserveEntrySignatures === 'allow-extension'
    },
    outputOptions(output) {
      // Keep static per-operation re-exports for tree-shaking, but coalesce their
      // retained dynamic entries. Do not pull shared dependencies out of other chunks.
      if (
        !groupErrors ||
        output.codeSplitting === false ||
        output.manualChunks ||
        output.advancedChunks
      )
        return output
      const splitting = typeof output.codeSplitting === 'object' ? output.codeSplitting : {}
      return {
        ...output,
        codeSplitting: {
          ...splitting,
          groups: [
            ...(splitting.groups ?? []),
            {
              debugName: 'openapi-errors',
              name: (id: string) =>
                `openapi-errors-${createHash('sha256')
                  .update(relative(root, id.split(errorsQuery)[0]!).replaceAll('\\', '/'))
                  .digest('hex')
                  .slice(0, 12)}`,
              test: (id: string) => id.includes(errorsQuery),
              includeDependenciesRecursively: false,
            },
          ],
        },
      }
    },
    watchChange() {
      cache.clear()
    },
    hotUpdate(context) {
      const affected = [...realPaths].filter(
        ([file, physical]) =>
          file === context.file ||
          physical === context.file ||
          dependencies
            .get(file)
            ?.some(
              (dependency) =>
                context.file === dependency || context.file.startsWith(`${dependency}${sep}`),
            ) ||
          [`${file}.queries.ts`, `${file}.errors.ts`].includes(context.file),
      )
      if (!affected.length) return
      const modules = new Set(context.modules)
      for (const [file] of affected) {
        cache.delete(file)
        for (const module of this.environment.moduleGraph.getModulesByFile(file) ?? []) {
          this.environment.moduleGraph.invalidateModule(module)
          modules.add(module)
        }
      }
      return [...modules]
    },
  }
}
