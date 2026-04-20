import type { NodeDefault } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppTypeEnum } from '@/types/app'
import { BlockEnum } from '../../types'
import Blocks from '../blocks'
import { BlockClassificationEnum } from '../types'

const runtimeState = vi.hoisted(() => ({
  appType: 'workflow' as string | undefined,
  nodes: [] as Array<{ data: { type?: BlockEnum } }>,
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => runtimeState.nodes,
    }),
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { type?: string } }) => unknown) => selector({
    appDetail: {
      type: runtimeState.appType,
    },
  }),
}))

const createBlock = (type: BlockEnum, title: string, classification = BlockClassificationEnum.Default): NodeDefault => ({
  metaData: {
    classification,
    sort: 0,
    type,
    title,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

describe('Blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.appType = AppTypeEnum.WORKFLOW
    runtimeState.nodes = []
  })

  it('should hide human input blocks when the app is an evaluation workflow', () => {
    runtimeState.appType = AppTypeEnum.EVALUATION

    render(
      <Blocks
        searchText=""
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.HumanInput, BlockEnum.LLM]}
        blocks={[
          createBlock(BlockEnum.HumanInput, 'Human Input'),
          createBlock(BlockEnum.LLM, 'LLM'),
        ]}
      />,
    )

    expect(screen.queryByText('Human Input')).not.toBeInTheDocument()
    expect(screen.getByText('LLM')).toBeInTheDocument()
  })

  it('should render grouped blocks, filter duplicate knowledge-base nodes, and select a block', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    runtimeState.nodes = [{ data: { type: BlockEnum.KnowledgeBase } }]

    render(
      <Blocks
        searchText=""
        onSelect={onSelect}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.LoopEnd, BlockEnum.KnowledgeBase]}
        blocks={[
          createBlock(BlockEnum.LLM, 'LLM'),
          createBlock(BlockEnum.LoopEnd, 'Exit Loop', BlockClassificationEnum.Logic),
          createBlock(BlockEnum.KnowledgeBase, 'Knowledge Retrieval'),
        ]}
      />,
    )

    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByText('Exit Loop')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.loop.loopNode')).toBeInTheDocument()
    expect(screen.queryByText('Knowledge Retrieval')).not.toBeInTheDocument()

    await user.click(screen.getByText('LLM'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.LLM)
  })

  it('should show the empty state when no block matches the search text', () => {
    render(
      <Blocks
        searchText="missing"
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.LLM]}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
      />,
    )

    expect(screen.getByText('workflow.tabs.noResult')).toBeInTheDocument()
  })
})
