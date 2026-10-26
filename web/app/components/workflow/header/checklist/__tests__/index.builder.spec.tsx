import type { ChecklistItem } from '../../../hooks/use-checklist'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { difyBuilderSessionBusyAtom } from '@/app/components/workflow-app/components/dify-builder/session/state'
import {
  difyBuilderChecklistErrorsAtom,
  difyBuilderRuntimeAtom,
} from '@/app/components/workflow-app/components/dify-builder/store'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import { renderWorkflowFlowComponent as render } from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import WorkflowChecklist from '../index'

const mockChecklistItems: ChecklistItem[] = [
  {
    id: 'plugin-1',
    type: BlockEnum.Tool,
    title: 'Missing Plugin',
    errorMessages: [],
    canNavigate: false,
    isPluginMissing: true,
  },
  {
    id: 'node-1',
    type: BlockEnum.LLM,
    title: 'Broken Node',
    errorMessages: ['Needs configuration'],
    canNavigate: true,
    isPluginMissing: false,
  },
]

const mockHandleNodeSelect = vi.fn()
const mockStartChecklistFix = vi.fn(async () => true)

const renderChecklist = (
  props: React.ComponentProps<typeof WorkflowChecklist>,
  { busy = false, canEdit = true, enabled = true } = {},
) => {
  const store = createStore()
  store.set(queryClientAtom, createConsoleQueryClient())
  store.set(
    difyBuilderRuntimeAtom,
    createDifyBuilderRuntime({
      canEdit,
      enabled,
      session: { startChecklistFix: mockStartChecklistFix },
    }),
  )
  store.set(difyBuilderSessionBusyAtom, busy)
  return {
    ...render(
      <Provider store={store}>
        <WorkflowChecklist {...props} />
      </Provider>,
    ),
    builderStore: store,
  }
}

vi.mock('../../../hooks/use-checklist', () => ({
  useChecklist: () => mockChecklistItems,
}))

vi.mock('../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

describe('Builder checklist fixes', () => {
  it('should start a checklist fix from the entry at the bottom of the list', async () => {
    const user = userEvent.setup()
    const { builderStore: store } = renderChecklist({ disabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist 2' }))
    await user.click(screen.getByRole('button', { name: 'difyBuilder.fixRun' }))

    expect(screen.getByRole('button', { name: 'workflow.panel.checklist 2' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(mockStartChecklistFix).toHaveBeenCalledWith(
      'app-1',
      [
        expect.objectContaining({
          node_id: 'node-1',
          messages: ['Needs configuration'],
        }),
      ],
      undefined,
    )
    expect(store.get(difyBuilderChecklistErrorsAtom)).toEqual([
      expect.objectContaining({ node_id: 'node-1', messages: ['Needs configuration'] }),
    ])
  })

  it('should hide checklist Fix while Builder is disabled', async () => {
    const user = userEvent.setup()
    renderChecklist({ disabled: false }, { enabled: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist 2' }))

    expect(screen.queryByRole('button', { name: 'difyBuilder.fixRun' })).not.toBeInTheDocument()
  })

  it('should keep checklist Fix disabled without edit access or while the session is busy', async () => {
    const user = userEvent.setup()
    const { unmount } = renderChecklist({ disabled: false }, { canEdit: false })

    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist 2' }))
    expect(screen.getByRole('button', { name: 'difyBuilder.fixRun' })).toBeDisabled()

    unmount()
    renderChecklist({ disabled: false }, { busy: true })
    await user.click(screen.getByRole('button', { name: 'workflow.panel.checklist 2' }))
    expect(screen.getByRole('button', { name: 'difyBuilder.fixRun' })).toBeDisabled()
  })
})
