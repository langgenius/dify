import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { MessageContentEvent, MessageContentPart } from './protocol/types'

/** Append streamed prose to the trailing text part or create a new text part in order. */
export function appendTextPart(
  parts: MessageContentPart[] | undefined,
  text: string,
): MessageContentPart[] {
  const current = parts ?? []
  if (!text) return current
  const last = current.at(-1)
  if (last?.type === 'text')
    return [...current.slice(0, -1), { ...last, text: last.text + text }]
  return [...current, { id: `text:${current.length}`, type: 'text', text }]
}

/** Apply ordered OpenUI snapshots and deltas in place without duplicating replayed content. */
export function updateContentPart(
  parts: MessageContentPart[] | undefined,
  update: MessageContentEvent['data'],
): MessageContentPart[] {
  const currentParts = parts ?? []
  const index = currentParts.findIndex((part) => part.type === 'openui' && part.id === update.id)
  const existing = index >= 0 ? currentParts[index] : undefined
  const current = existing?.type === 'openui' ? existing : undefined
  if (current && current.sequence >= update.sequence) return currentParts

  let nextBlock: OpenUIContentBlock
  if (update.type === 'openui_delta') {
    // Reattachment can miss the base. Wait for the final snapshot instead of displaying corrupt source.
    if (!current || current.status !== 'streaming' || current.sequence !== update.base_sequence)
      return currentParts
    nextBlock = {
      ...current,
      source: current.source + update.source_delta,
      sequence: update.sequence,
    }
  } else {
    nextBlock = update
  }

  if (!current) return [...currentParts, nextBlock]
  return currentParts.map((part, partIndex) => (partIndex === index ? nextBlock : part))
}

/** Replace one saved UI block inside ordered parts without disturbing sibling prose or UI. */
export function replaceSavedBlockInParts(
  parts: MessageContentPart[] | undefined,
  block: OpenUIContentBlock,
): MessageContentPart[] | undefined {
  return parts?.map((part) => (part.type === 'openui' && part.id === block.id ? block : part))
}

/** A closed transport cannot leave a partially generated interface interactive. */
export function interruptContentParts(
  parts: MessageContentPart[] | undefined,
  status: 'cancelled' | 'error',
): MessageContentPart[] | undefined {
  return parts?.map((part) =>
    part.type === 'openui' && part.status === 'streaming' ? { ...part, status } : part,
  )
}

export function hasOpenUIParts(parts: MessageContentPart[] | undefined): boolean {
  return !!parts?.some((part) => part.type === 'openui')
}
