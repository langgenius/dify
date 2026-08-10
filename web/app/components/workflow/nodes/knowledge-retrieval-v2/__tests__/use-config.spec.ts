import type { KnowledgeRetrievalV2NodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { BlockEnum } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockSetInputs = vi.fn()

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: vi.fn(),
}))

vi.mock('../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  query_variable_selector: ['start', 'sys.query'],
  control_space_ids: ['space-1'],
  top_n: 10,
  ...overrides,
})

describe('knowledge-retrieval-v2/use-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const setup = (inputs = createData()) => {
    mockUseNodeCrud.mockReturnValue({ inputs, setInputs: mockSetInputs } as never)
    return renderHook(() => useConfig('node-1', inputs))
  }

  it('updates the query selector', () => {
    const { result } = setup()

    act(() => result.current.handleQueryVarChange(['start', 'question']))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        query_variable_selector: ['start', 'question'],
      }),
    )
  })

  it('keeps the selected space summary with the graph configuration', () => {
    const { result } = setup()

    act(() =>
      result.current.handleSpaceToggle({
        control_space_id: 'space-2',
        name: 'Product docs',
        default_mode: 'fast',
      }),
    )

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        control_space_ids: ['space-1', 'space-2'],
        _control_spaces: expect.arrayContaining([
          expect.objectContaining({ control_space_id: 'space-2', name: 'Product docs' }),
        ]),
      }),
    )
  })

  it('removes empty metadata filter collections', () => {
    const { result } = setup(createData({ metadata_filters: { tags: ['policy'] } }))

    act(() => result.current.handleMetadataFilterChange('tags', []))

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.not.objectContaining({
        metadata_filters: expect.anything(),
      }),
    )
  })

  it('rejects an out-of-range top n in the editor', () => {
    const { result } = setup()

    act(() => result.current.handleTopNChange(101))

    expect(mockSetInputs).not.toHaveBeenCalled()
  })
})
