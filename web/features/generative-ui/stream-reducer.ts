import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { MessageContentEvent } from './protocol/types'

/** Apply ordered appends and snapshots without duplicating replayed content. */
export function updateContentBlock(
  blocks: OpenUIContentBlock[] | undefined,
  update: MessageContentEvent['data'],
): OpenUIContentBlock[] {
  const currentBlocks = blocks ?? []
  const index = currentBlocks.findIndex((block) => block.id === update.id)
  const current = currentBlocks[index]
  if (current && current.sequence >= update.sequence) return currentBlocks

  let nextBlock: OpenUIContentBlock
  if (update.type === 'openui_delta') {
    // Reattachment can miss the base. Wait for the final snapshot instead of displaying corrupt source.
    if (!current || current.status !== 'streaming' || current.sequence !== update.base_sequence)
      return currentBlocks
    nextBlock = {
      ...current,
      source: current.source + update.source_delta,
      sequence: update.sequence,
    }
  } else {
    nextBlock = update
  }

  if (!current) return [...currentBlocks, nextBlock]
  return currentBlocks.map((block, blockIndex) => (blockIndex === index ? nextBlock : block))
}

/** A closed transport cannot leave a partially generated interface interactive. */
export function interruptContentBlocks(
  blocks: OpenUIContentBlock[] | undefined,
  status: 'cancelled' | 'error',
): OpenUIContentBlock[] | undefined {
  return blocks?.map((block) => (block.status === 'streaming' ? { ...block, status } : block))
}
