import type { Plugin } from 'vite-plus'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

// Sidecar modules written to every server output directory after the bundles are generated.
const SIDECARS = ['vinext-client-assets.js', '__vite_rsc_assets_manifest.js']

function importPath(fromFile: string, toFile: string) {
  const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * When the ssr output is nested in the rsc output (Cloudflare `childEnvironments: ['ssr']`), both
 * environments ship in one Worker, and every module both of them use is emitted twice. In Dify that
 * is about 17 MiB, mostly i18n JSON chunks, against the Worker's 64 MiB upload limit.
 *
 * Every ssr chunk that imports nothing and is byte-identical to the rsc chunk with the same file
 * name becomes a re-export of that rsc chunk. A chunk with no imports holds data or self-contained
 * code, so one instance behaves the same for both environments. A chunk with imports keeps its own
 * copy, because sharing it could merge state that must stay per environment.
 *
 * plugin-rsc builds rsc before ssr, so the rsc chunks are known when the ssr bundle is generated.
 * The two sidecars are written to disk after both builds, so they are compared in a post buildApp
 * hook. Upstream: https://github.com/cloudflare/vinext/issues/4766
 */
export function dedupeNestedSsrOutput(): Plugin {
  const rscChunks = new Map<string, string>()
  // ssr chunks rewritten as re-exports: file name -> the code their rsc twin must still have.
  const sharedCode = new Map<string, string>()
  let rscOutDir: string | undefined
  let ssrOutDir: string | undefined
  let sharedChunks = 0
  let sharedBytes = 0

  const isNested = () => !!rscOutDir && !!ssrOutDir && ssrOutDir.startsWith(rscOutDir + path.sep)

  return {
    name: 'dify:dedupe-nested-ssr-output',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const { name, config } = this.environment
        const outDir = path.resolve(config.root, config.build.outDir)
        if (name === 'rsc') {
          rscOutDir = outDir
          rscChunks.clear()
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === 'chunk' && !chunk.imports.length && !chunk.dynamicImports.length)
              rscChunks.set(chunk.fileName, chunk.code)
          }
          return
        }
        if (name !== 'ssr') return
        ssrOutDir = outDir
        if (!isNested()) return
        sharedCode.clear()
        sharedChunks = 0
        sharedBytes = 0
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || chunk.isEntry) continue
          if (chunk.imports.length || chunk.dynamicImports.length) continue
          if (!chunk.exports.length || rscChunks.get(chunk.fileName) !== chunk.code) continue
          const twin = importPath(
            path.join(ssrOutDir, chunk.fileName),
            path.join(rscOutDir!, chunk.fileName),
          )
          sharedCode.set(chunk.fileName, chunk.code)
          sharedBytes += Buffer.byteLength(chunk.code)
          sharedChunks++
          chunk.code = `export { ${chunk.exports.join(', ')} } from ${JSON.stringify(twin)}\n`
          chunk.map = null
          if (chunk.sourcemapFileName) delete bundle[chunk.sourcemapFileName]
        }
      },
    },
    buildApp: {
      order: 'post',
      async handler(builder) {
        const { logger } = builder.config
        if (!isNested()) {
          logger.warn(
            `[dedupe-nested-ssr-output] the ssr output (${ssrOutDir}) is not inside the rsc output (${rscOutDir}); nothing was deduplicated`,
          )
          return
        }
        // A re-export to a file the Worker does not ship, or one that changed after the comparison,
        // would only fail at runtime. Fail the build instead.
        const broken = [...sharedCode].filter(([fileName, code]) => {
          const rscFile = path.join(rscOutDir!, fileName)
          return !fs.existsSync(rscFile) || fs.readFileSync(rscFile, 'utf8') !== code
        })
        if (broken.length) {
          throw new Error(
            `[dedupe-nested-ssr-output] ${broken.length} ssr modules re-export an rsc module that is missing or changed after the comparison: ${broken
              .slice(0, 5)
              .map(([fileName]) => fileName)
              .join(', ')}`,
          )
        }
        for (const sidecar of SIDECARS) {
          const ssrFile = path.join(ssrOutDir!, sidecar)
          const rscFile = path.join(rscOutDir!, sidecar)
          if (!fs.existsSync(ssrFile) || !fs.existsSync(rscFile)) continue
          const code = fs.readFileSync(ssrFile, 'utf8')
          if (code !== fs.readFileSync(rscFile, 'utf8')) continue
          fs.writeFileSync(
            ssrFile,
            `export { default } from ${JSON.stringify(importPath(ssrFile, rscFile))}\n`,
          )
          sharedChunks++
          sharedBytes += Buffer.byteLength(code)
        }
        if (!sharedChunks) {
          logger.warn(
            '[dedupe-nested-ssr-output] no ssr module matched its rsc twin; check whether the build layout changed',
          )
          return
        }
        logger.info(
          `[dedupe-nested-ssr-output] shared ${sharedChunks} ssr modules with rsc (${(sharedBytes / 1024 / 1024).toFixed(1)} MiB)`,
        )
      },
    },
  }
}
