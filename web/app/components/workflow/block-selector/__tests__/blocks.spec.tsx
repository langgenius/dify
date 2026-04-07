import { render, screen } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { AppTypeEnum } from '@/types/app'
import { BlockEnum } from '../../types'
import Blocks from '../blocks'

const mockGetNodes = vi.fn(() => [])
const mockAppType = vi.hoisted<{ current?: string }>(() => ({
  current: 'workflow',
}))

vi.mock('reactflow', () => ({
  useStoreApi: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { type?: string } }) => unknown) => selector({
    appDetail: {
      type: mockAppType.current,
    },
  }),
}))

const mockUseStoreApi = vi.mocked(useStoreApi)

describe('Blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppType.current = AppTypeEnum.WORKFLOW
    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes: mockGetNodes,
      }),
    } as unknown as ReturnType<typeof useStoreApi>)
  })

  it('should hide human input in evaluation workflows', () => {
    mockAppType.current = AppTypeEnum.EVALUATION

    render(
      <Blocks
        searchText=""
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.HumanInput, BlockEnum.LLM]}
      />,
    )

    expect(screen.queryByText('workflow.blocks.human-input')).not.toBeInTheDocument()
    expect(screen.getByText('workflow.blocks.llm')).toBeInTheDocument()
  })
})
