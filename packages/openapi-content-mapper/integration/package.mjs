import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        GOMAXPROCS: '1',
        GOMEMLIMIT: '512MiB',
        RAYON_NUM_THREADS: '1',
        NODE_OPTIONS: '--max-old-space-size=1024',
        pnpm_config_verify_deps_before_run: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
      killSignal: 'SIGKILL',
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-32_768)
    })
    child.stderr.on('data', (chunk) => {
      output = (output + chunk).slice(-32_768)
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}:\n${output}`)),
    )
  })
}

async function files(directory, prefix = '') {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) found.push(...(await files(join(directory, entry.name), `${name}/`)))
    else found.push(name)
  }
  return found
}

test('packed SDK installs and works outside the workspace with npm and official Vite', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const directory = await mkdtemp(join(tmpdir(), 'openapi-package-'))
  try {
    const tarball = process.env.OPENAPI_PACKAGE_TARBALL
      ? resolve(process.env.OPENAPI_PACKAGE_TARBALL)
      : join(directory, 'sdk.tgz')
    await run('pnpm', ['pack', '--out', tarball], root)
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    )
    await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarball,
        'typescript@7.1.0-beta',
        'vite@8.3.5',
      ],
      directory,
    )
    const installed = join(directory, 'node_modules', manifest.name)
    const packed = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    assert.equal(packed.name, manifest.name)
    assert.equal(packed.version, manifest.version)
    assert(!packed.private)
    assert(!packed.dependencies.vite)
    assert.equal(packed.peerDependenciesMeta.vite.optional, true)
    for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare'])
      assert(
        !packed.scripts?.[lifecycle],
        `Consumer lifecycle must not build the package: ${lifecycle}`,
      )
    assert.equal(packed.license, 'SEE LICENSE IN LICENSE')
    assert.equal(
      await readFile(join(root, 'LICENSE'), 'utf8'),
      await readFile(join(root, '../../LICENSE'), 'utf8'),
    )
    assert.equal(
      await readFile(join(installed, 'LICENSE'), 'utf8'),
      await readFile(join(root, 'LICENSE'), 'utf8'),
    )
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'])
      for (const version of Object.values(packed[section] ?? {}))
        assert(
          !/^(?:catalog|workspace|link|file):/.test(version),
          `Unresolved package dependency: ${version}`,
        )
    const packedFiles = await files(installed)
    assert(packedFiles.includes('README.md'))
    assert(packedFiles.includes('CHANGELOG.md'))
    for (const file of packedFiles)
      assert(
        /^(?:dist\/.*\.(?:js|d\.ts)|package\.json|README\.md|LICENSE|CHANGELOG\.md)$/.test(file),
        `Unexpected packaged file: ${file}`,
      )
    for (const target of Object.values(packed.exports)) {
      if (typeof target === 'string') continue
      assert(packedFiles.includes(target.types.slice(2)), `Missing declarations: ${target.types}`)
      assert(packedFiles.includes(target.default.slice(2)), `Missing runtime: ${target.default}`)
    }
    assert(packedFiles.includes(packed.typescript.contentMapper.exec[1]))
    await writeFile(
      join(directory, 'export.mjs'),
      `console.log(JSON.stringify({
      openapi: '3.1.0', paths: { '/status': { get: { responses: { 200: { content: {
        'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } }
      } } } } } }
    }));`,
    )
    await writeFile(
      join(directory, 'backend.openapi-source'),
      JSON.stringify({
        command: ['node', 'export.mjs'],
        inputs: ['export.mjs'],
      }),
    )
    await writeFile(
      join(directory, 'backend.openapi-source.config.ts'),
      `
export { default } from './pets.yaml.config.ts';
export type { Context } from './pets.yaml.config.ts';
`,
    )
    await writeFile(
      join(directory, 'pets.yaml'),
      `
openapi: 3.1.0
paths:
  /pets/{petId}:
    get:
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                required: [name]
                properties:
                  name:
                    type: string
  /UNUSED_ENDPOINT:
    get:
      responses:
        '204':
          description: unused
`,
    )
    await writeFile(
      join(directory, 'pets.yaml.config.ts'),
      `
import type { RuntimeConfig } from '@dify/openapi-content-mapper';
import { createClient } from '@dify/openapi-content-mapper';
export type Context = { name?: string };
const runtime: RuntimeConfig<Context> = {
  queryKeyPrefix: ['pets'],
  createClient: ({context}) => createClient({
    baseUrl: 'https://example.test',
    fetch: async () => context?.name === 'conflict'
      ? Response.json({code: 'CONFLICT'}, {status: 409})
      : Response.json({name: context?.name ?? 'Mochi'}),
  }),
};
export default runtime;
`,
    )
    await writeFile(
      join(directory, 'pets.yaml.queries.ts'),
      `const defaults = {queryOptions: {staleTime: 1234}}; export {defaults as 'GET /pets/{petId}'};`,
    )
    await writeFile(
      join(directory, 'pets.yaml.errors.ts'),
      `const errors = {CONFLICT: {status: 409}}; export {errors as 'GET /pets/{petId}'};`,
    )
    await writeFile(
      join(directory, 'index.ts'),
      `
import { api, query } from './pets.yaml';
import { api as backend } from './backend.openapi-source';
import { safe } from '@orpc/client';
const backendName: string = (await backend.status.get()).name;
// @ts-expect-error command-source types survive packaging
const wrongBackendName: number = (await backend.status.get()).name;
const result = await safe(api.pets.byPetId.get({params: {petId: 1}}));
if (result.isDefined) { const code: 'CONFLICT' = result.error.code; }
const pet = await api.pets.byPetId.get({params: {petId: 1}}, {context: {name: 'Mochi'}});
const name: string = pet.name;
query.pets.byPetId.get.queryOptions({input: {params: {petId: 1}}, context: {name: 'Mochi'}});
// @ts-expect-error inferred request types survive packaging
api.pets.byPetId.get({params: {petId: 'wrong'}});
// @ts-expect-error sidecar context survives packaging
api.pets.byPetId.get({params: {petId: 1}}, {context: {name: 123}});
`,
    )
    for (const module of ['NodeNext', 'ESNext']) {
      await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: 'ES2022',
            module,
            moduleResolution: module === 'NodeNext' ? 'NodeNext' : 'Bundler',
            types: [],
            allowImportingTsExtensions: true,
          },
          contentMappers: [
            {
              package: manifest.name,
              extensions: ['.yaml', '.openapi', '.openapi-source'],
              options: { sources: ['./backend.openapi-source'] },
            },
          ],
          include: ['*.ts'],
        }),
      )
      await run(
        process.execPath,
        ['node_modules/typescript/bin/tsc', '--runExternalCode', '--noEmit'],
        directory,
      )
    }
    await writeFile(
      join(directory, 'runtime.mjs'),
      `
import assert from 'node:assert/strict';
import * as document from './pets.yaml';
import { api as backend } from './backend.openapi-source';
import { safe } from '@orpc/client';
assert.deepEqual(await backend.status.get(undefined, {context: {name: 'backend'}}), {name: 'backend'});
assert.deepEqual(Object.keys(document), ['api', 'query']);
assert.deepEqual(await document.api.pets.byPetId.get({params: {petId: 1}}, {context: {name: 'packed'}}), {name: 'packed'});
assert.deepEqual(document.query.key(), [['pets'], {}]);
assert.equal(document.query.pets.byPetId.get.queryOptions({input: {params: {petId: 1}}}).staleTime, 1234);
const failure = await safe(document.api.pets.byPetId.get({params: {petId: 1}}, {context: {name: 'conflict'}}));
assert.equal(failure.isDefined, true);
assert.equal(failure.error.code, 'CONFLICT');
assert.equal(typeof (await import('@dify/openapi-content-mapper/loader')).default, 'function');
`,
    )
    await run(process.execPath, ['--import', `${manifest.name}/register`, 'runtime.mjs'], directory)
    await writeFile(
      join(directory, 'entry.mjs'),
      `
import { api } from './pets.yaml';
import { api as backend } from './backend.openapi-source';
export const getPet = (input) => api.pets.byPetId.get(input);
export const getStatus = () => backend.status.get();
`,
    )
    await writeFile(
      join(directory, 'bundle.mjs'),
      `
import assert from 'node:assert/strict';
import { build } from 'vite';
import { openapi } from '@dify/openapi-content-mapper/vite';
const result = await build({
  configFile: false, logLevel: 'silent', plugins: [openapi()],
  build: { write: false, lib: {entry: './entry.mjs', formats: ['es']} },
});
const code = result[0].output.filter(file => file.type === 'chunk').map(file => file.code).join('\\n');
assert(code.includes('/pets/{petId}'));
assert(code.includes('/status'));
assert(!code.includes('export.mjs'));
assert(!code.includes('UNUSED_ENDPOINT'));
assert(!code.includes('parseDocument'));
`,
    )
    await run(process.execPath, ['bundle.mjs'], directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
