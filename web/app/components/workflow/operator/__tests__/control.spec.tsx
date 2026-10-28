import type { Shape } from '../../store/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { baseRunningData, renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NOTE_NODE } from '../../note-node/constants'
import { ControlMode, WorkflowRunningStatus } from '../../types'
import Control from '../control'

vi.mock('../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-sync-draft')>()
  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: vi.fn(),
    }),
  }
})

// The add-block selector and image export own their own suites and service setup.
vi.mock('../add-block', () => ({
  default: () => null,
}))

vi.mock('../export-image', () => ({
  ExportImage: () => null,
}))

const renderControl = ({
  initialStoreState,
  collaborationEnabled = true,
}: {
  initialStoreState?: Partial<Shape>
  collaborationEnabled?: boolean
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: { name: 'Ada' },
    systemFeatures: { enable_collaboration_mode: collaborationEnabled },
  })
  return renderWorkflowFlowComponent(<Control />, {
    queryClient,
    nodes: [createNode({ id: 'node-1' })],
    initialStoreState: { controlMode: ControlMode.Pointer, ...initialStoreState },
  })
}

const getModeButton = (mode: 'pointerMode' | 'handMode' | 'commentMode') =>
  screen.getByRole('button', { name: `workflow.common.${mode}` })

describe('Control', () => {
  it('switches the canvas between pointer, hand, and comment modes', async () => {
    const user = userEvent.setup()
    const { store } = renderControl()

    expect(getModeButton('pointerMode')).toHaveAttribute('aria-pressed', 'true')

    await user.click(getModeButton('handMode'))
    expect(store.getState().controlMode).toBe(ControlMode.Hand)
    expect(getModeButton('handMode')).toHaveAttribute('aria-pressed', 'true')
    expect(getModeButton('pointerMode')).toHaveAttribute('aria-pressed', 'false')

    await user.click(getModeButton('commentMode'))
    expect(store.getState().controlMode).toBe(ControlMode.Comment)
    expect(getModeButton('commentMode')).toHaveAttribute('aria-pressed', 'true')

    await user.click(getModeButton('pointerMode'))
    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('creates a note candidate attributed to the current user', async () => {
    const user = userEvent.setup()
    const { store } = renderControl()

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.note.addNote' }))

    expect(store.getState().candidateNode).toMatchObject({
      type: CUSTOM_NOTE_NODE,
      data: expect.objectContaining({ author: 'Ada', showAuthor: true, _isCandidate: true }),
    })
  })

  it('starts organizing blocks when the canvas is editable', async () => {
    const user = userEvent.setup()
    const { store } = renderControl()

    await user.click(screen.getByRole('button', { name: 'workflow.panel.organizeBlocks' }))

    await waitFor(() => expect(store.getState().nodeAnimation).toBe(true))
  })

  it('keeps read-only editing actions focusable without changing the canvas', async () => {
    const user = userEvent.setup()
    const { store } = renderControl({ initialStoreState: { canvasReadOnly: true } })

    const noteButton = screen.getByRole('button', { name: 'workflow.nodes.note.addNote' })
    expect(noteButton).toHaveAttribute('aria-disabled', 'true')
    noteButton.focus()
    expect(noteButton).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(getModeButton('handMode'))
    await user.click(screen.getByRole('button', { name: 'workflow.panel.organizeBlocks' }))

    expect(store.getState()).toMatchObject({
      candidateNode: undefined,
      controlMode: ControlMode.Hand,
      nodeAnimation: false,
    })
  })

  it('still allows comment mode on a read-only canvas', async () => {
    const user = userEvent.setup()
    const { store } = renderControl({ initialStoreState: { canvasReadOnly: true } })

    await user.click(getModeButton('commentMode'))

    expect(store.getState().controlMode).toBe(ControlMode.Comment)
  })

  it('blocks comment mode while a workflow run is in progress', async () => {
    const user = userEvent.setup()
    const { store } = renderControl({
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Running },
        }),
      },
    })

    const commentButton = getModeButton('commentMode')
    expect(commentButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(commentButton)

    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('hides comment mode when collaboration is unavailable', () => {
    renderControl({ collaborationEnabled: false })

    expect(
      screen.queryByRole('button', { name: 'workflow.common.commentMode' }),
    ).not.toBeInTheDocument()
  })
})
