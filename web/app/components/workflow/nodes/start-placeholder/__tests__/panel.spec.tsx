import type {
  AvailableNodesMetaData,
  SyncDraftCallback,
} from '@/app/components/workflow/hooks-store'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createWorkflowSlice } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import startDefault from '../../start/default'
import Panel from '../panel'

const syncDraft =
  vi.fn<(sync?: boolean, notRefresh?: boolean, callback?: SyncDraftCallback) => void>()
const generateUrl = vi.fn()
// Catalog selection and URL generation are independent boundaries; graph replacement stays real.
vi.mock('@/app/components/workflow/block-selector/all-start-blocks', () => ({
  default: ({ onSelect }: { onSelect: (type: BlockEnum) => void }) => (
    <button type="button" onClick={() => onSelect(BlockEnum.Start)}>
      Select User Input
    </button>
  ),
}))
vi.mock('../../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: syncDraft }),
}))
vi.mock('../../../hooks/use-auto-generate-webhook-url', () => ({
  useAutoGenerateWebhookUrl: () => generateUrl,
}))
function GraphState() {
  const nodes = useNodes()
  return <output aria-label="Graph">{JSON.stringify(nodes)}</output>
}

it('replaces the placeholder, deselects its neighbor and waits for draft persistence before generating URLs', async () => {
  const placeholder = createNode({
    id: 'placeholder-1',
    data: { type: BlockEnum.StartPlaceholder, selected: true },
  })
  const selectedStart = {
    metaData: startDefault.metaData,
    checkValid: () => ({ isValid: true }),
    defaultValue: { ...startDefault.defaultValue, title: 'User Input', desc: '' },
  }
  // Only the Start catalog entry is exposed by the selector boundary in this scenario.
  const nodesMap: Partial<NonNullable<AvailableNodesMetaData['nodesMap']>> = {
    [BlockEnum.Start]: selectedStart,
  }
  const { store } = renderWorkflowFlowComponent(
    <>
      <Panel
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
        id={placeholder.id}
        data={placeholder.data}
      />
      <GraphState />
    </>,
    {
      injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
      nodes: [placeholder, createNode({ id: 'other-node', data: { selected: true } })],
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [selectedStart],
          nodesMap: nodesMap as AvailableNodesMetaData['nodesMap'],
        },
      },
    },
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Select User Input' }))
  const nodes = JSON.parse(screen.getByLabelText('Graph').textContent!)
  expect(nodes[0]).toMatchObject({
    id: 'placeholder-1',
    data: { type: BlockEnum.Start, title: 'User Input', selected: true, variables: [] },
  })
  expect(nodes[1].data.selected).toBe(false)
  expect(store.getState().hasSelectedStartNode).toBe(true)
  expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(true)
  expect(generateUrl).not.toHaveBeenCalled()
  const [sync, notRefresh, callback] = syncDraft.mock.calls[0]!
  expect([sync, notRefresh]).toEqual([true, false])
  act(() => callback?.onSuccess?.())
  expect(generateUrl).toHaveBeenCalledWith('placeholder-1')
})
