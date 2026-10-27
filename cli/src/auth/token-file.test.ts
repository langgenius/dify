import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { readTokenFile } from './token-file'

const SECRET = 'dfoa_x'

describe('readTokenFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-token-file-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function write(content: string): Promise<string> {
    const path = join(dir, 'token.json')
    await writeFile(path, content)
    return path
  }

  it('returns access_token and ignores unknown keys', async () => {
    const path = await write(
      JSON.stringify({
        access_token: SECRET,
        token_type: 'Bearer',
        refresh_token: 'r',
        future: 1,
      }),
    )
    expect(await readTokenFile(path)).toBe(SECRET)
  })

  const badContents: Array<[string, string]> = [
    ['empty file', ''],
    ['not json', 'not json'],
    ['plain text token', JSON.stringify(SECRET)],
    ['raw text token', SECRET],
    ['array', '[]'],
    ['empty access_token', '{"access_token":""}'],
    ['non-string access_token', '{"access_token":5}'],
    ['missing access_token', `{"refresh_token":"${SECRET}"}`],
  ]

  it.each(badContents)('rejects %s as not_logged_in', async (_name, content) => {
    const path = await write(content)
    const err = await readTokenFile(path).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BaseError)
    const base = err as BaseError
    expect(base.code).toBe(ErrorCode.NotLoggedIn)
    expect(base.toString()).not.toContain(SECRET)
    expect(String(base.cause ?? '')).not.toContain(SECRET)
  })

  it('rejects a missing file as not_logged_in', async () => {
    const err = await readTokenFile(join(dir, 'absent.json')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BaseError)
    expect((err as BaseError).code).toBe(ErrorCode.NotLoggedIn)
  })
})
