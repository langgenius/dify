/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise byte framing used by the external compiler process. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import { readFrames } from '../dist/tooling/framing.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

function frame(payload) {
  return Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
}
async function* chunks(input, size) {
  for (let offset = 0; offset < input.length; offset += size)
    yield input.subarray(offset, offset + size)
}
async function collect(input, size) {
  const result = []
  for await (const payload of readFrames(chunks(input, size))) result.push(payload.toString())
  return result
}

test('frames preserve byte lengths across fragmented headers, Unicode and coalesced requests', async () => {
  const payloads = ['{"text":"中文 🐱"}', '', '{"id":2}', 'next']
  const input = Buffer.concat(payloads.map(frame))
  for (const size of [1, 7, input.length]) assert.deepEqual(await collect(input, size), payloads)
  const large = '文'.repeat(1024 * 1024)
  assert.deepEqual(await collect(frame(large), 4096), [large])
})

test('frames reject invalid sizes, oversized headers and truncated input', async () => {
  for (const input of [
    'Content-Length: -1\r\n\r\n',
    'Content-Length: 67108865\r\n\r\n',
    'Content-Length: 1.5\r\n\r\n',
    'Content-Length: 3\r\n\r\nx',
    'Content-Length:',
    'x'.repeat(8193),
  ])
    await assert.rejects(collect(Buffer.from(input), 31), /content mapper (frame|header)/)
})
