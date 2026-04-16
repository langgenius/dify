import type { CommonNodeType } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import useNodeCrud from '../use-node-crud'

const mockHandleNodeDataUpdateWithSyncDraft = vi.hoisted(() => ({
  current: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft.current,
  }),
}))

type TestNodeData = CommonNodeType<{
  value: string
}>

const createData = (value = 'initial'): TestNodeData => ({
  type: BlockEnum.LLM,
  title: 'Test Node',
  desc: '',
  value,
})

describe('useNodeCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleNodeDataUpdateWithSyncDraft.current = vi.fn()
  })

  it('keeps setInputs stable across rerenders when id does not change', () => {
    const { result, rerender } = renderHook(
      ({ id, data }) => useNodeCrud(id, data),
      {
        initialProps: {
          id: 'node-1',
          data: createData(),
        },
      },
    )

    const firstSetInputs = result.current.setInputs

    rerender({
      id: 'node-1',
      data: createData('updated'),
    })

    expect(result.current.setInputs).toBe(firstSetInputs)
  })

  it('forwards node data updates with the current node id and latest updater', () => {
    const { result, rerender } = renderHook(
      ({ id, data }) => useNodeCrud(id, data),
      {
        initialProps: {
          id: 'node-1',
          data: createData(),
        },
      },
    )

    result.current.setInputs(createData('changed'))

    expect(mockHandleNodeDataUpdateWithSyncDraft.current).toHaveBeenCalledWith({
      id: 'node-1',
      data: createData('changed'),
    })

    const nextUpdater = vi.fn()
    mockHandleNodeDataUpdateWithSyncDraft.current = nextUpdater

    rerender({
      id: 'node-1',
      data: createData('changed'),
    })

    result.current.setInputs(createData('latest'))

    expect(nextUpdater).toHaveBeenCalledWith({
      id: 'node-1',
      data: createData('latest'),
    })
  })
})
