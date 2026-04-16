import type { NodeDefault } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import NodeSelector from '../main'
import { BlockClassificationEnum } from '../types'

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector({
    systemFeatures: { enable_marketplace: false },
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

const createBlock = (type: BlockEnum, title: string): NodeDefault => ({
  metaData: {
    classification: BlockClassificationEnum.Default,
    sort: 0,
    type,
    title,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

describe('NodeSelector', () => {
  it('opens with the real blocks tab, filters by search, selects a block, and clears search after close', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderWorkflowComponent(
      <NodeSelector
        onSelect={onSelect}
        blocks={[
          createBlock(BlockEnum.LLM, 'LLM'),
          createBlock(BlockEnum.End, 'End'),
        ]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.End]}
        trigger={open => (
          <button type="button">
            {open ? 'selector-open' : 'selector-closed'}
          </button>
        )}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    const searchInput = screen.getByPlaceholderText('workflow.tabs.searchBlock')
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()

    await user.type(searchInput, 'LLM')
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.queryByText('End')).not.toBeInTheDocument()

    await user.click(screen.getByText('LLM'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.LLM, undefined)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('workflow.tabs.searchBlock')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    const reopenedInput = screen.getByPlaceholderText('workflow.tabs.searchBlock') as HTMLInputElement
    expect(reopenedInput.value).toBe('')
    expect(screen.getByText('End')).toBeInTheDocument()
  })
})
