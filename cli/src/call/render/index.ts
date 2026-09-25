import type { CallFlags } from '@/call/flags'
import type { ExitCodeValue } from '@/errors/codes'
import type { IOService } from '@/plugins/io'
import type { Kind } from '@/protocol/kinds'
import { isKind, KIND } from '@/protocol/kinds'
import { fileRenderer } from './file'
import { listRenderer } from './list'
import { objectRenderer } from './object'
import { sseRenderer } from './sse'
import { textRenderer } from './text'

export type Renderer = (
  res: Response,
  io: IOService,
  flags: CallFlags,
  opId: string,
) => Promise<ExitCodeValue>

const RENDERERS: Readonly<Record<Kind, Renderer>> = {
  [KIND.Object]: objectRenderer,
  [KIND.List]: listRenderer,
  [KIND.Sse]: sseRenderer,
  [KIND.Text]: textRenderer,
  [KIND.File]: fileRenderer,
}

export function rendererFor(kind: string, io: IOService): Renderer {
  if (isKind(kind)) return RENDERERS[kind]
  io.notice(`unknown kind ${kind}, printing as object`)
  return objectRenderer
}
