import type { ToolBlockPayload } from './node'
import { createCommand } from 'lexical'

export const INSERT_TOOL_BLOCK_COMMAND = createCommand<ToolBlockPayload>('INSERT_TOOL_BLOCK_COMMAND')
export const DELETE_TOOL_BLOCK_COMMAND = createCommand('DELETE_TOOL_BLOCK_COMMAND')
