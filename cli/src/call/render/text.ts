import type { Renderer } from './index'
import { Buffer } from 'node:buffer'
import { ExitCode } from '@/errors/codes'

export const textRenderer: Renderer = async (res, io) => {
  if (res.body !== null) {
    for await (const bytes of res.body) await io.raw(Buffer.from(bytes))
  }
  return ExitCode.Success
}
