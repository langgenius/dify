/* oxlint-disable antfu/no-import-dist -- Measure the production adapters using the built package. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { openapi } from '../dist/tooling/vite.js'
/* oxlint-enable antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const web = join(repo, 'web')
const directory = mkdtempSync(join(web, '.console-benchmark-'))
const output = resolve(
  process.argv.find((arg) => arg.endsWith('.json')) ?? '/tmp/dify-console-benchmark.json',
)
const compiler = join(root, 'node_modules/typescript/bin/tsc')
const report = {
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
  runtime: process.version,
  compiler: spawnSync(process.execPath, [compiler, '--version'], {
    encoding: 'utf8',
  }).stdout.trim(),
  scope:
    'Actual Console entries, with query defaults, typed errors and all four sources. Bundle excludes shared app auth/config/error reporting on both sides. Gzip sums individual chunks; type timings are serial CLI checks of a scoped application consumer, not the full Web project or editor latency.',
  bundles: [],
  types: [],
}
const save = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
const operation = 'knowledgeFs.spaces.byControlSpaceId.metadata.get'
const input = "{ params: { control_space_id: 'space-1' }, query: { limit: 100 } }"
const sources = { mapper: '@/service/console/inferred', orpc: '@/service/console' }
const shared = ['service/base.ts', 'service/client-error.ts', 'config/index.ts'].map((file) =>
  join(web, file),
)
try {
  if (!process.argv.includes('--types-only')) {
    for (const [name, source] of Object.entries(sources)) {
      for (const mode of ['api', 'query']) {
        const entry = join(directory, 'bundle.ts')
        const body =
          mode === 'api'
            ? `export const call = (input) => consoleClient.${operation}(input);`
            : `export const options = (input) => consoleQuery.${operation}.queryOptions({ input });`
        writeFileSync(entry, `import { consoleClient, consoleQuery } from '${source}';\n${body}`)
        // oxlint-disable-next-line antfu/no-top-level-await -- The benchmark intentionally builds each case serially.
        const result = await build({
          configFile: false,
          root: web,
          logLevel: 'silent',
          resolve: { alias: { '@': web } },
          plugins: [openapi()],
          build: {
            write: false,
            minify: true,
            lib: { entry, formats: ['es'] },
            rollupOptions: { external: shared },
          },
        })
        const chunks = (Array.isArray(result) ? result : [result])
          .flatMap((r) => r.output)
          .filter((file) => file.type === 'chunk')
        const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
        function closure(seeds) {
          const seen = new Set()
          function visit(file) {
            if (seen.has(file) || !byName.has(file)) return
            seen.add(file)
            for (const child of byName.get(file).imports) visit(child)
          }
          for (const seed of seeds) visit(seed)
          return seen
        }
        const initial = closure(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
        const contract = chunks
          .filter((c) =>
            Object.keys(c.modules).some((id) =>
              id.includes('generated/api/console/knowledge-fs/orpc.gen.ts'),
            ),
          )
          .map((c) => c.fileName)
        if (name === 'orpc') assert(contract.length, 'Expected the lazy KnowledgeFS contract chunk')
        const success = closure([...initial, ...contract])
        const error = name === 'mapper' ? closure(chunks.map((c) => c.fileName)) : success
        const size = (files) => ({
          bytes: [...files].reduce(
            (sum, file) => sum + Buffer.byteLength(byName.get(file).code),
            0,
          ),
          gzip: [...files].reduce((sum, file) => sum + gzipSync(byName.get(file).code).length, 0),
          chunks: files.size,
        })
        const row = {
          name,
          mode,
          initial: size(initial),
          firstSuccess: size(success),
          firstError: size(error),
          allEmitted: size(new Set(byName.keys())),
        }
        report.bundles.push(row)
        process.stdout.write(`${JSON.stringify(row)}\n`)
        save()
      }
    }
  }
  if (!process.argv.includes('--bundle-only')) {
    const config = {
      extends: join(web, 'tsconfig.json'),
      compilerOptions: { incremental: true, tsBuildInfoFile: './state.tsbuildinfo' },
      include: [
        'consumer.ts',
        join(web, 'next-env.d.ts'),
        join(web, 'global.d.ts'),
        join(web, 'types/**/*.d.ts'),
      ],
    }
    for (const [name, source] of Object.entries(sources)) {
      const dir = join(directory, name)
      mkdirSync(dir)
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config))
      writeFileSync(
        join(dir, 'consumer.ts'),
        `import { consoleClient, consoleQuery } from '${source}';\nimport { safe } from '@orpc/client';\nexport const options = consoleQuery.${operation}.queryOptions({ input: ${input} });\nexport async function call() { return safe(consoleClient.${operation}(${input})); }\nexport const deployment = consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({ input: { params: { app_id: 'app' } } });\n`,
      )
    }
    const env = {
      ...process.env,
      GOMAXPROCS: '1',
      GOMEMLIMIT: '768MiB',
      RAYON_NUM_THREADS: '1',
      NODE_OPTIONS: '--max-old-space-size=512',
    }
    function run(name, phase) {
      const start = performance.now()
      const result = spawnSync(
        process.execPath,
        [
          compiler,
          '--runExternalCode',
          '--pretty',
          'false',
          '--extendedDiagnostics',
          '-p',
          join(directory, name),
        ],
        { cwd: repo, encoding: 'utf8', timeout: 180000, env },
      )
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const metrics = Object.fromEntries(
        result.stdout.split('\n').flatMap((line) => {
          const offset = line.indexOf(':')
          const value = Number.parseFloat(line.slice(offset + 1))
          return offset > 0 && Number.isFinite(value) ? [[line.slice(0, offset), value]] : []
        }),
      )
      const row = { name, phase, wallMs: Math.round(performance.now() - start), metrics }
      report.types.push(row)
      process.stdout.write(`${JSON.stringify(row)}\n`)
      save()
    }
    // Evict only this document's mapper slot. Do not disturb unrelated workspaces.
    const owner = process.getuid?.() ?? process.env.USERNAME ?? 'user'
    const file = join(web, 'service/console/console.openapi')
    const hash = createHash('sha256').update(file).digest('hex')
    rmSync(join(tmpdir(), `dify-openapi-content-mapper-${owner}`, `${hash}.cache`), { force: true })
    for (const name of Object.keys(sources)) run(name, 'cold')
    for (let iteration = 0; iteration < 5; iteration++)
      for (const name of Object.keys(sources)) run(name, `no-change-${iteration + 1}`)
    for (const name of Object.keys(sources)) {
      const consumer = join(directory, name, 'consumer.ts')
      writeFileSync(consumer, readFileSync(consumer, 'utf8').replace("'space-1'", "'space-2'"))
      run(name, 'edit-input')
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
