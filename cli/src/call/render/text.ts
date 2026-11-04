import type { Renderer } from './index'
import { Buffer } from 'node:buffer'
import { ExitCode } from '@/errors/codes'

export const textRenderer: Renderer = async (res, io) => {
  const bytes = await res.arrayBuffer()
  await io.raw(Buffer.from(bytes))
  return ExitCode.Success
}
