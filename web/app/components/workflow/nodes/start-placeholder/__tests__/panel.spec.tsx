import type { Node } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const mocks = vi.hoisted(() => ({
  autoGenerateWebhookUrl: vi.fn(),
  handleSyncWorkflowDraft: vi.fn(),
  setHasSelectedStartNode: vi.fn(),
  setNodes: vi.fn(),
  setShouldAutoOpenStartNodeSelector: vi.fn(),
}))

let currentNodes: Node[] = []

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => currentNodes,
      setNodes: mocks.setNodes,
    }),
  }),
}))

vi.mock('@/app/components/plugins/marketplace/search-box', () => ({
  default: () => <input aria-label="Search trigger" />,
}))

vi.mock('@/app/components/workflow/block-selector/all-start-blocks', () => ({
  default: ({ onSelect }: { onSelect: (type: BlockEnum) => void }) => (
    <button type="button" onClick={() => onSelect(BlockEnum.Start)}>
      Select User Input
    </button>
  ),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAutoGenerateWebhookUrl: () => mocks.autoGenerateWebhookUrl,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: unknown) => unknown) => selector({
    availableNodesMetaData: {
      nodesMap: {
        [BlockEnum.Start]: {
          defaultValue: {
            title: 'User Input',
            desc: '',
            variables: [],
          },
        },
      },
    },
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mocks.handleSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({
    setHasSelectedStartNode: mocks.setHasSelectedStartNode,
    setShouldAutoOpenStartNodeSelector: mocks.setShouldAutoOpenStartNodeSelector,
  }),
}))

const createPlaceholderNode = (): Node => ({
  id: 'placeholder-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.StartPlaceholder,
    title: 'Pick a start node',
    desc: '',
    selected: true,
  },
})

describe('StartPlaceholderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentNodes = [
      createPlaceholderNode(),
      {
        id: 'other-node',
        type: 'custom',
        position: { x: 100, y: 0 },
        data: {
          type: BlockEnum.LLM,
          title: 'LLM',
          desc: '',
          selected: true,
        },
      },
    ]
    mocks.setNodes.mockImplementation((nodes: Node[]) => {
      currentNodes = nodes
    })
  })

  describe('Start node selection', () => {
    it('should replace the placeholder with user input and auto-open the next node selector', () => {
      render(
        <Panel
          id="placeholder-1"
          data={createPlaceholderNode().data}
          panelProps={{} as never}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Select User Input' }))

      expect(mocks.setNodes).toHaveBeenCalledTimes(1)
      expect(currentNodes[0]).toMatchObject({
        id: 'placeholder-1',
        data: {
          type: BlockEnum.Start,
          title: 'User Input',
          selected: true,
          variables: [],
        },
      })
      expect(currentNodes[1]?.data.selected).toBe(false)
      expect(mocks.setHasSelectedStartNode).toHaveBeenCalledWith(true)
      expect(mocks.setShouldAutoOpenStartNodeSelector).toHaveBeenCalledWith(true)
      expect(mocks.handleSyncWorkflowDraft).toHaveBeenCalledWith(true, false, expect.objectContaining({
        onSuccess: expect.any(Function),
      }))

      const callback = mocks.handleSyncWorkflowDraft.mock.calls[0]?.[2] as { onSuccess: () => void }
      callback.onSuccess()

      expect(mocks.autoGenerateWebhookUrl).toHaveBeenCalledWith('placeholder-1')
    })
  })
})
