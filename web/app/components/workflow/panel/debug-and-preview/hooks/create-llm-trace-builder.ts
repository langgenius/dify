import type { IOnDataMoreInfo } from '@/service/base'
import type { NodeTracing } from '@/types/workflow'
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '../../../types'

type ChunkMeta = Pick<IOnDataMoreInfo, 'node_id' | 'tool_call_id' | 'tool_name' | 'tool_arguments' | 'tool_icon' | 'tool_icon_dark' | 'tool_error' | 'tool_elapsed_time' | 'model_provider' | 'model_name' | 'model_icon' | 'model_icon_dark' | 'model_usage' | 'model_duration'>

const TRACKED_CHUNK_TYPES = ['model_start', 'model_end', 'tool_call', 'tool_result', 'text', 'thought', 'thought_start', 'thought_end']

export function createLLMTraceBuilder() {
  return function update(
    tracing: NodeTracing[] | undefined,
    chunkType: IOnDataMoreInfo['chunk_type'],
    message: string,
    meta: ChunkMeta,
  ): number {
    if (!tracing)
      return -1

    if (!chunkType || !TRACKED_CHUNK_TYPES.includes(chunkType))
      return -1

    let targetNodeIndex = -1
    if (meta.node_id) {
      targetNodeIndex = tracing.findIndex(item => item.node_id === meta.node_id)
    }
    if (targetNodeIndex < 0) {
      for (let i = tracing.length - 1; i >= 0; i--) {
        if (tracing[i].status === NodeRunningStatus.Running || tracing[i].status === WorkflowRunningStatus.Running) {
          targetNodeIndex = i
          break
        }
      }
    }

    if (targetNodeIndex < 0)
      return -1

    const node = tracing[targetNodeIndex]
    if (!node.execution_metadata)
      node.execution_metadata = { llm_trace: [] } as unknown as NodeTracing['execution_metadata']
    if (!node.execution_metadata!.llm_trace)
      node.execution_metadata!.llm_trace = []

    const trace = node.execution_metadata!.llm_trace!

    if (chunkType === 'model_start') {
      trace.push({
        type: 'model',
        name: meta.model_name || '',
        duration: 0,
        output: { text: null, reasoning: null },
        provider: meta.model_provider,
        icon: meta.model_icon,
        icon_dark: meta.model_icon_dark,
      })
    }

    if (chunkType === 'text') {
      const last = trace[trace.length - 1]
      if (last?.type === 'model')
        last.output.text = (last.output.text ?? '') + message
    }

    if (chunkType === 'thought_start' || chunkType === 'thought' || chunkType === 'thought_end') {
      const last = trace[trace.length - 1]
      if (last?.type === 'model')
        last.output.reasoning = (last.output.reasoning ?? '') + message
    }

    if (chunkType === 'model_end') {
      for (let i = trace.length - 1; i >= 0; i--) {
        if (trace[i].type === 'model') {
          trace[i].duration = meta.model_duration || 0
          trace[i].usage = meta.model_usage || null
          trace[i].status = 'success'
          break
        }
      }
    }

    if (chunkType === 'tool_call') {
      const lastModel = trace.findLast(item => item.type === 'model')
      if (lastModel) {
        if (!lastModel.output.tool_calls)
          lastModel.output.tool_calls = []
        lastModel.output.tool_calls.push({
          id: meta.tool_call_id || '',
          name: meta.tool_name || '',
          arguments: meta.tool_arguments || '',
        })
      }
      trace.push({
        type: 'tool',
        name: meta.tool_name || '',
        duration: 0,
        output: {
          id: meta.tool_call_id || null,
          name: meta.tool_name || null,
          arguments: meta.tool_arguments || null,
          output: null,
        },
        icon: meta.tool_icon,
        icon_dark: meta.tool_icon_dark,
      })
    }

    if (chunkType === 'tool_result') {
      for (let i = trace.length - 1; i >= 0; i--) {
        if (trace[i].type === 'tool') {
          trace[i].output.output = message
          trace[i].error = meta.tool_error
          trace[i].duration = meta.tool_elapsed_time || 0
          trace[i].status = meta.tool_error ? 'error' : 'success'
          break
        }
      }
    }

    return targetNodeIndex
  }
}
