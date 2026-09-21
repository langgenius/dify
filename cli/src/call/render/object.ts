import type { Renderer } from './index'
import type { ExitCodeValue } from '@/errors/codes'
import type { IOService, Printable } from '@/plugins/io'
import { parseJsonBody } from '@/call/json-body'
import { ExitCode } from '@/errors/codes'

export async function renderJsonLine(io: IOService, value: Printable): Promise<ExitCodeValue> {
  await io.line(value)
  return ExitCode.Success
}

export const objectRenderer: Renderer = async (res, io) =>
  renderJsonLine(io, await parseJsonBody(res))
