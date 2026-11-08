import { renderHook } from '@testing-library/react'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { usePipelineTemplate } from '../use-pipeline-template'

it('starts a pipeline with a selected knowledge index and no connections', () => {
  const { result } = renderHook(() => usePipelineTemplate())

  expect(result.current.edges).toEqual([])
  expect(result.current.nodes).toEqual([
    expect.objectContaining({
      id: 'knowledgeBase',
      position: { x: START_INITIAL_POSITION.x + 500, y: START_INITIAL_POSITION.y },
      data: expect.objectContaining({
        type: 'knowledge-index',
        selected: true,
        title: 'workflow.blocks.knowledge-index',
      }),
    }),
  ])
})
