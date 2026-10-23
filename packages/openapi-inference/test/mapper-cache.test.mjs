/* oxlint-disable vitest/no-import-node-test -- Exercise the mapper's disposable disk cache directly. */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
/* oxlint-disable antfu/no-import-dist -- Verify the emitted modules used by the external compiler process. */
import { createCachedTransform } from '../dist/tooling/mapper-cache.js'
import { transformSpec } from '../dist/tooling/transform.js'
/* oxlint-enable antfu/no-import-dist */
/* oxlint-enable vitest/no-import-node-test */

const spec = 'openapi: 3.1.0\npaths: {}'

test('mapper cache survives instances and invalidates on content, location, implementation and sidecars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-cache-test-'))
  try {
    const cache = join(dir, 'cache')
    const file = join(dir, 'spec.yaml')
    let calls = 0
    const transform = (content, fileName) => {
      calls++
      return transformSpec(content, fileName)
    }
    const first = createCachedTransform(cache, 'v1', transform)
    const expected = first(spec, file)
    assert.equal(calls, 1)
    const second = createCachedTransform(cache, 'v1', transform)
    assert.deepEqual(second(spec, file), expected)
    assert.equal(calls, 1)
    second(`${spec}\n# moved source positions`, file)
    assert.equal(calls, 2)
    second(spec, join(dir, 'other.yaml'))
    assert.equal(calls, 3)
    const next = createCachedTransform(cache, 'v2', transform)
    next(spec, file)
    assert.equal(calls, 4)
    writeFileSync(`${file}.config.ts`, 'export type Context = { token: string }')
    const configured = next(spec, file)
    assert.match(configured.text, /spec\.yaml\.config\.ts/)
    assert.equal(calls, 5)
    rmSync(`${file}.config.ts`)
    assert.doesNotMatch(next(spec, file).text, /spec\.yaml\.config\.ts/)
    assert.equal(calls, 6)
    assert(readdirSync(cache).every((name) => name.endsWith('.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt caches, incomplete writes and unavailable cache directories cannot break mapping', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-cache-test-'))
  try {
    const file = join(dir, 'spec.yaml')
    const cache = join(dir, 'cache')
    const cached = createCachedTransform(cache, 'v1')
    const expected = cached(spec, file)
    const entry = join(cache, readdirSync(cache)[0])
    const original = JSON.parse(readFileSync(entry, 'utf8'))
    for (const corrupt of [
      '{',
      JSON.stringify({ ...original, result: { text: 'bad' } }),
      JSON.stringify({ ...original, result: { ...expected, text: 'broken cached TypeScript' } }),
      JSON.stringify({ ...original, result: { ...expected, mappings: [[0, 1, 0, 1, 2, 1]] } }),
    ]) {
      writeFileSync(entry, corrupt)
      assert.deepEqual(cached(spec, file), expected)
    }
    const blocked = join(dir, 'not-a-directory')
    writeFileSync(blocked, '')
    assert.deepEqual(createCachedTransform(blocked, 'v1')(spec, file), expected)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('diagnostics are not cached and document revisions reuse a bounded set of slots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openapi-cache-test-'))
  try {
    const cache = join(dir, 'cache')
    const cached = createCachedTransform(cache, 'v1')
    const file = join(dir, 'spec.yaml')
    assert(cached('openapi: [', file).diagnostics)
    assert.deepEqual(readdirSync(dir), [])
    for (let version = 0; version < 3; version++) cached(`${spec}\n# ${version}`, file)
    assert.equal(readdirSync(cache).length, 1)
    for (let i = 0; i < 70; i++) cached(spec, join(dir, `${i}.yaml`))
    assert.equal(readdirSync(cache).length, 64)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
