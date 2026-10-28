/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise type-only command sources through the real compiler. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { inspectSource, resolveDocument, sourceProject } from '../dist/tooling/source.js'
import { transformSpec } from '../dist/tooling/transform.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')

test('package sources merge with explicit sources and track shared inputs and module additions', (t) => {
  const dir = mkdtempSync(join(import.meta.dirname, '.package-sources-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bundled = join(dir, 'contracts')
  mkdirSync(join(bundled, 'console'), { recursive: true })
  const input = join(dir, 'schema.txt')
  writeFileSync(input, 'string')
  const config = {
    command: ['node', '-e', 'throw new Error("Registration must not run exporters")'],
    cwd: '..',
    inputs: ['schema.txt'],
  }
  const shared = join(bundled, 'shared.json')
  writeFileSync(shared, JSON.stringify(config))
  const descriptor = JSON.stringify({ extends: '../shared.json', args: ['first'] })
  const first = join(bundled, 'console/first.openapi-types')
  writeFileSync(first, descriptor)
  const custom = join(dir, 'custom.openapi-types')
  writeFileSync(custom, JSON.stringify({ ...config, cwd: '.' }))
  const configPath = join(dir, 'tsconfig.json')
  const options = { sources: ['./custom.openapi-types'] }
  const inspect = () => sourceProject(configPath, options, bundled)
  const initial = inspect()
  assert.deepEqual([...initial.registered].sort(), [first, custom].sort())
  for (const file of [bundled, join(bundled, 'console'), first, shared, input, custom])
    assert(initial.watchedFiles.includes(file), file)
  writeFileSync(input, 'number')
  const changed = inspect()
  assert.notEqual(changed.configIdentity, initial.configIdentity)
  writeFileSync(shared, JSON.stringify({ ...config, timeoutMs: 10000 }))
  assert.notEqual(inspect().configIdentity, changed.configIdentity)
  const added = join(bundled, 'console/second.openapi-types')
  writeFileSync(added, descriptor)
  assert(inspect().registered.has(added))
  rmSync(first)
  assert(!inspect().registered.has(first))
  const standalone = sourceProject(configPath, options, join(dir, 'missing-contracts'))
  assert.deepEqual([...standalone.registered], [custom])
})

test('thin type sources inherit cwd and watched inputs and invalidate when shared configuration changes', (t) => {
  const dir = mkdtempSync(join(import.meta.dirname, '.inherited-source-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'modules'))
  writeFileSync(join(dir, 'input.txt'), 'string')
  writeFileSync(
    join(dir, 'export.mjs'),
    `
process.stdout.write(JSON.stringify({typescript: 'export type Module = ' + JSON.stringify(process.argv[2]) + ';'}));
`,
  )
  const base = join(dir, 'base.json')
  const config = { command: ['node', 'export.mjs'], inputs: ['input.txt', 'export.mjs'] }
  writeFileSync(base, JSON.stringify(config))
  const file = join(dir, 'modules/types.openapi-types')
  const content = JSON.stringify({ extends: '../base.json', args: ['datasets'] })
  writeFileSync(file, content)
  const inspected = inspectSource(content, file)
  assert.equal(inspected.cwd, dir)
  assert.deepEqual(inspected.command, ['node', 'export.mjs', 'datasets'])
  assert(inspected.dependencies.includes(base))
  assert(inspected.dependencies.includes(join(dir, 'input.txt')))
  assert.match(resolveDocument(content, file).content, /datasets/)
  const before = sourceProject(join(dir, 'tsconfig.json'), {
    sources: ['./modules/*.openapi-types'],
  })
  writeFileSync(base, JSON.stringify({ ...config, timeoutMs: 10000 }))
  const after = sourceProject(join(dir, 'tsconfig.json'), {
    sources: ['./modules/*.openapi-types'],
  })
  assert.notEqual(after.configIdentity, before.configIdentity)
  assert.notEqual(inspectSource(content, file).identity, inspected.identity)
  writeFileSync(base, JSON.stringify({ extends: './modules/types.openapi-types' }))
  assert.throws(() => inspectSource(content, file), /Circular source descriptor/)
  assert.throws(() => inspectSource('{"extends":42}', file), /extends must be/)
  assert.throws(() => inspectSource('{"extends":"../missing.json"}', file), /ENOENT/)
})

test('type sources track inputs, preserve named exports, and invalidate incremental checks', (t) => {
  const dir = mkdtempSync(join(import.meta.dirname, '.type-source-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'sources'))
  writeFileSync(join(dir, 'schema.txt'), 'string')
  writeFileSync(
    join(dir, 'export.mjs'),
    `
import {readFileSync} from 'node:fs';
process.stdout.write(JSON.stringify({typescript:
  'export type Model = {name: ' + readFileSync('schema.txt', 'utf8') + '};' +
  'export type GetData = {path: {id: string}; url: "/pets/{id}"};' +
  'export type GetResponses = {200: Model; 204: void};' +
  'export type GetResponse = GetResponses[keyof GetResponses];' +
  'export type GetErrors = {404: {code: "missing"}; default: {message: string}};' +
  'export type GetError = GetErrors[keyof GetErrors];'
}));`,
  )
  const descriptor = JSON.stringify({
    cwd: '..',
    command: ['node', 'export.mjs'],
    inputs: ['schema.txt', 'export.mjs'],
  })
  const source = join(dir, 'sources/types.openapi-types')
  writeFileSync(source, descriptor)
  const config = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      incremental: true,
      skipLibCheck: true,
      target: 'ES2022',
      module: 'NodeNext',
    },
    contentMappers: [
      {
        package: root,
        extensions: ['.openapi-types'],
        options: { sources: ['./sources/*.openapi-types'] },
      },
    ],
    include: ['check.ts'],
  }
  const configPath = join(dir, 'tsconfig.json')
  writeFileSync(configPath, JSON.stringify(config))
  writeFileSync(
    join(dir, 'check.ts'),
    `
import type {Model, GetData, GetResponses, GetResponse, GetErrors, GetError} from './sources/types.openapi-types';
const name: string = (null! as Model).name;
const input: GetData = {path: {id: 'a'}, url: '/pets/{id}'};
const response: GetResponse = null! as GetResponses[200];
const error: GetError = null! as GetErrors[404];
// @ts-expect-error legacy envelopes do not accept params
const wrong: GetData = {params: {id: 'a'}, url: '/pets/{id}'};
// @ts-expect-error status-indexed response maps are retained
type MissingStatus = GetResponses[201];
`,
  )
  const compile = () =>
    spawnSync(process.execPath, [compiler, '--runExternalCode', '-p', dir], { encoding: 'utf8' })
  const first = compile()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const before = sourceProject(configPath, config.contentMappers[0].options)
  assert(before.registered.has(source))
  writeFileSync(join(dir, 'schema.txt'), 'number')
  assert.notEqual(
    sourceProject(configPath, config.contentMappers[0].options).configIdentity,
    before.configIdentity,
  )
  const changed = compile()
  assert.notEqual(changed.status, 0)
  assert.match(changed.stdout + changed.stderr, /number.*string/)
  writeFileSync(join(dir, 'sources/new.openapi-types'), descriptor)
  assert.equal(sourceProject(configPath, config.contentMappers[0].options).registered.size, 2)
  config.contentMappers[0].options.sources = []
  writeFileSync(configPath, JSON.stringify(config))
  const unregistered = compile()
  assert.notEqual(unregistered.status, 0)
  assert.match(unregistered.stdout + unregistered.stderr, /options.sources/)
  writeFileSync(join(dir, 'export.mjs'), 'process.stdout.write(JSON.stringify({typescript: ""}))')
  assert.throws(() => resolveDocument(readFileSync(source, 'utf8'), source), /non-empty typescript/)
  assert(transformSpec('{"typescript":42}', source).diagnostics)
})
