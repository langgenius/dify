import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AsyncEntry } from '@napi-rs/keyring'

// Use an isolated service so this check never reads or replaces CLI credentials.
const service = `difyctl-native-smoke-${randomUUID()}`
const account = 'round-trip'
const entry = new AsyncEntry(service, account)
try {
  assert.equal(await entry.getPassword(), null)
  assert.equal(await entry.deletePassword(), false)
  await entry.setPassword('first-test-value')
  assert.equal(await new AsyncEntry(service, account).getPassword(), 'first-test-value')
  await entry.setPassword('replacement-test-value')
  assert.equal(await new AsyncEntry(service, account).getPassword(), 'replacement-test-value')
  assert.equal(await entry.deletePassword(), true)
  assert.equal(await entry.getPassword(), null)
  assert.equal(await entry.deletePassword(), false)
  console.log(`Native keyring round trip passed on ${process.platform}/${process.arch}`)
} finally {
  await entry.deletePassword()
}
