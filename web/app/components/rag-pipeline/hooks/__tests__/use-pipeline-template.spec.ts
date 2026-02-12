import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePipelineTemplate } from '../use-pipeline-template'

vi.mock('@/app/components/workflow/constants', () => ({
  START_INITIAL_POSITION: { x: 100, y: 200 },
}))

vi.mock('@/app/components/workflow/nodes/knowledge-base/default', () => ({
  default: {
    metaData: { type: 'knowledge-base' },
    defaultValue: { title: 'Knowledge Base' },
  },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  generateNewNode: ({ id, data, position }: { id: string, data: Record<string, unknown>, position: { x: number, y: number } }) => ({
    newNode: { id, data, position, type: 'custom' },
  }),
}))

describe('usePipelineTemplate', () => {
  it('should return nodes array with one knowledge base node', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.nodes[0].id).toBe('knowledgeBase')
  })

  it('should return empty edges array', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.edges).toEqual([])
  })

  it('should set node type from knowledge-base default', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0].data.type).toBe('knowledge-base')
  })

  it('should set node as selected', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0].data.selected).toBe(true)
  })

  it('should position node offset from START_INITIAL_POSITION', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0].position.x).toBe(600)
    expect(result.current.nodes[0].position.y).toBe(200)
  })

  it('should translate node title', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0].data.title).toBe('workflow.blocks.knowledge-base')
  })
})
