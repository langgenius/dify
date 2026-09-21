import type { Renderer } from './index'
import type { ExitCodeValue } from '@/errors/codes'
import type { IOService, Printable } from '@/plugins/io'
import { parseJsonBody } from '@/call/json-body'
import { ExitCode } from '@/errors/codes'

export async function renderJson(io: IOService, value: Printable): Promise<ExitCodeValue> {
  await io.document(value)
  return ExitCode.Success
}

export const objectRenderer: Renderer = async (res, io) => renderJson(io, await parseJsonBody(res))
