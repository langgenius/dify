import type { BaseError } from '@/errors/base'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { ErrorCode } from '@/errors/codes'
import { readTokenFile } from './token-file'

const SECRET = 'dfoa_x'
const dir = mkdtempSync(join(tmpdir(), 'difyctl-token-file-'))

function write(content: string): string {
  const path = join(dir, 'token.json')
  writeFileSync(path, content)
  return path
}

it('returns access_token and ignores unknown keys', async () => {
  expect(
    await readTokenFile(write(JSON.stringify({ access_token: SECRET, refresh_token: 'r' }))),
  ).toBe(SECRET)
})

it.each([
  ['not json', SECRET],
  ['empty access_token', '{"access_token":""}'],
  ['missing access_token', `{"refresh_token":"${SECRET}"}`],
])('rejects %s as not_logged_in without leaking the file', async (_name, content) => {
  const err = await readTokenFile(write(content)).catch((e: unknown) => e)
  expect(err).toMatchObject({ code: ErrorCode.NotLoggedIn })
  expect(String(err)).not.toContain(SECRET)
  expect(String((err as BaseError).cause ?? '')).not.toContain(SECRET)
})

it('rejects a missing file as not_logged_in', async () => {
  await expect(readTokenFile(join(dir, 'absent.json'))).rejects.toMatchObject({
    code: ErrorCode.NotLoggedIn,
  })
})
