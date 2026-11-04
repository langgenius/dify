/* oxlint-disable vitest/no-import-node-test -- Compare every generated error map with the current Console contracts. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consoleRouterContract } from '../../contracts/console.ts'
import * as maps from '../../contracts/generated/api/console/errors.gen.ts'
/* oxlint-enable vitest/no-import-node-test */

test('standalone error maps preserve every Console status, code and validated payload', async (t) => {
  let operations = 0
  let cases = 0
  async function walk(node) {
    const definition = node?.['~orpc']
    if (!definition) {
      for (const child of Object.values(node)) await walk(child)
      return
    }
    if (!Object.keys(definition.errorMap).length) return
    const key = `${definition.route.method} ${definition.route.path}`
    const actual = maps[key]
    assert(actual, `Missing ${key}`)
    assert.deepEqual(Object.keys(actual), Object.keys(definition.errorMap))
    operations++
    for (const [code, expected] of Object.entries(definition.errorMap)) {
      assert.equal(actual[code].status, expected.status)
      assert.equal(actual[code].message, expected.message)
      assert.equal(!!actual[code].data, !!expected.data)
      if (!expected.data) continue
      for (const value of [
        { code, message: 'message', status: expected.status, extra: 'must be stripped' },
        { code, message: 'message', status: expected.status, details: { value: [1, null] } },
        { code: 'unknown', message: 1, status: 'invalid' },
      ]) {
        assert.deepEqual(
          await actual[code].data['~standard'].validate(value),
          await expected.data['~standard'].validate(value),
          key,
        )
        cases++
      }
    }
  }
  await walk(consoleRouterContract)
  assert.equal(operations, Object.keys(maps).length)
  assert(operations > 0)
  t.diagnostic(`${operations} operation maps, ${cases} payload comparisons`)
})
