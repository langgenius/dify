import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { usePipelineTemplate } from '../use-pipeline-template'

describe('usePipelineTemplate', () => {
  it('should return nodes array with one knowledge base node', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.nodes[0]!.id).toBe('knowledgeBase')
  })

  it('should return empty edges array', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.edges).toEqual([])
  })

  it('should set node type from knowledge-base default', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0]!.data.type).toBe('knowledge-index')
  })

  it('should set node as selected', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0]!.data.selected).toBe(true)
  })

  it('should position node offset from START_INITIAL_POSITION', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0]!.position.x).toBe(START_INITIAL_POSITION.x + 500)
    expect(result.current.nodes[0]!.position.y).toBe(START_INITIAL_POSITION.y)
  })

  it('should translate node title', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes[0]!.data.title).toBe('workflow.blocks.knowledge-index')
  })
})
