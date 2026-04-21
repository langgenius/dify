import type { NodeDefault } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../types'
import Blocks from '../blocks'
import { BlockClassificationEnum } from '../types'

const runtimeState = vi.hoisted(() => ({
  nodes: [] as Array<{ data: { type?: BlockEnum } }>,
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => runtimeState.nodes,
    }),
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
    runtimeState.nodes = []
  })

  it('renders grouped blocks, filters duplicate knowledge-base nodes, and selects a block', async () => {
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

  it('shows the empty state when no block matches the search', () => {
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
