import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { BaseError, notLoggedInMessage } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export const TOKEN_FILE_REASON = 'DIFY_TOKEN_FILE has no usable access_token'
export const TOKEN_FILE_HINT = 'reconnect Dify in the platform that provides this file'

const TokenFileSchema = z.object({ access_token: z.string().min(1) })

function unusableTokenFile(): BaseError {
  return new BaseError({
    code: ErrorCode.NotLoggedIn,
    message: notLoggedInMessage(TOKEN_FILE_REASON),
    hint: TOKEN_FILE_HINT,
  })
}

export async function readTokenFile(path: string): Promise<string> {
  let parsed: ReturnType<typeof TokenFileSchema.safeParse>
  try {
    parsed = TokenFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    throw unusableTokenFile()
  }
  if (!parsed.success) throw unusableTokenFile()
  return parsed.data.access_token
}
