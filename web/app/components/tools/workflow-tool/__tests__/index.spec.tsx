import type { WorkflowToolDrawerPayload } from '../index'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { WorkflowToolDrawer } from '../index'

vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (labels: string[]) => void }) => (
    <div data-testid="label-selector">
      <span>{value.join(',')}</span>
      <button data-testid="append-label" onClick={() => onChange([...value, 'new-label'])}>
        Add
      </button>
    </div>
  ),
}))

vi.mock('../confirm-modal', () => ({
  default: ({
    show,
    onClose,
    onConfirm,
  }: {
    show: boolean
    onClose: () => void
    onConfirm: () => void
  }) =>
    show ? (
      <div data-testid="confirm-modal">
        <button data-testid="confirm-save" onClick={onConfirm}>
          Confirm
        </button>
        <button data-testid="close-confirm" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
  },
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'label1', label: 'Label 1' },
      { name: 'label2', label: 'Label 2' },
    ],
  }),
}))

const createPayload = (
  overrides: Partial<WorkflowToolDrawerPayload> = {},
): WorkflowToolDrawerPayload => ({
  icon: { content: '🔧', background: '#ffffff' },
  label: 'My Tool',
  name: 'my_tool',
  description: 'Tool description',
  parameters: [
    { name: 'param1', description: 'Parameter 1', form: 'llm', required: true, type: 'string' },
  ],
  outputParameters: [
    { name: 'output1', description: 'Output 1' },
    { name: 'text', description: 'Reserved output duplicate' },
  ],
  labels: ['label1'],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-1',
  workflow_tool_id: 'workflow-tool-1',
  ...overrides,
})

describe('WorkflowToolDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create workflow tools with edited form values', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolDrawer isAdd payload={createPayload()} onHide={vi.fn()} onCreate={onCreate} />,
    )

    await user.clear(screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'))
    await user.type(
      screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'),
      'Created Tool',
    )
    await user.click(screen.getByTestId('append-label'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_app_id: 'workflow-app-1',
        label: 'Created Tool',
        icon: { content: '🔧', background: '#ffffff' },
        labels: ['label1', 'new-label'],
      }),
    )
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty('outputParameters')
  })

  it('saves the confirmed icon without submitting the tool from the picker', async () => {
    const user = userEvent.setup()
    const client = new QueryClient()
    client.setQueryData(emojiCatalogOptions.queryKey, [])
    const onCreate = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <WorkflowToolDrawer isAdd payload={createPayload()} onHide={vi.fn()} onCreate={onCreate} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'tools.createTool.changeIcon' }))
    await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
    expect(onCreate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
      ).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ icon: { content: '🔧', background: '#F3FEE7' } }),
    )
    client.clear()
  })

  it('should block invalid tool-call names before saving', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({ name: 'bad-name' })}
        onHide={vi.fn()}
        onCreate={onCreate}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCreate).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
      }),
    )
  })

  it('should require confirmation before saving existing workflow tools', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(<WorkflowToolDrawer payload={createPayload()} onHide={vi.fn()} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-save'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_tool_id: 'workflow-tool-1',
          name: 'my_tool',
        }),
      )
    })
  })

  it('should not show output warnings when names are valid and unique', () => {
    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({
          outputParameters: [{ name: 'answer', description: 'Valid output' }],
        })}
        onHide={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', {
        name: 'answer',
      }),
    ).not.toBeInTheDocument()
  })

  it('should show one reserved-name warning on the user output only', () => {
    render(
      <WorkflowToolDrawer isAdd payload={createPayload()} onHide={vi.fn()} onCreate={vi.fn()} />,
    )

    const userOutputRow = screen.getByRole('row', { name: /text.*Reserved output duplicate/ })
    expect(
      within(userOutputRow).getByRole('button', {
        name: 'text',
      }),
    ).toBeInTheDocument()

    const reservedOutputRow = screen.getByRole('row', {
      name: /text.*tools\.createTool\.toolOutput\.reserved.*string/,
    })
    expect(within(reservedOutputRow).queryByRole('button')).not.toBeInTheDocument()
  })

  it('should identify the End node sources for duplicate outputs', async () => {
    const user = userEvent.setup()
    const outputParameters: WorkflowToolDrawerPayload['outputParameters'] = [
      {
        name: 'result',
        description: 'Success output',
        source: { nodeId: 'end-success', nodeTitle: 'Success End', outputIndex: 0 },
      },
      {
        name: 'result',
        description: 'Fallback output',
        source: { nodeId: 'end-fallback', nodeTitle: 'Fallback End', outputIndex: 0 },
      },
    ]

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({ outputParameters })}
        onHide={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('row', { name: /result.*Success End.*Success output/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('row', { name: /result.*Fallback End.*Fallback output/ }),
    ).toBeInTheDocument()

    const duplicateWarnings = screen.getAllByRole('button', {
      name: 'result',
    })
    expect(duplicateWarnings).toHaveLength(2)

    await user.click(duplicateWarnings[0]!)

    const duplicateDetails = (await screen.findAllByRole('dialog')).find((dialog) =>
      within(dialog).queryByText(/workflow\.errorMsg\.duplicateOutputVariable/),
    )!
    expect(duplicateDetails).toHaveTextContent('Success End')
    expect(duplicateDetails).toHaveTextContent('Fallback End')
  })

  it('does not warn on duplicate names proven safe by the workflow graph', () => {
    const outputParameters: WorkflowToolDrawerPayload['outputParameters'] = [
      {
        name: 'result',
        description: 'True output',
        source: { nodeId: 'end-true', nodeTitle: 'True End', outputIndex: 0 },
      },
      {
        name: 'result',
        description: 'False output',
        source: { nodeId: 'end-false', nodeTitle: 'False End', outputIndex: 0 },
      },
    ]

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({ outputParameters })}
        nonConflictingOutputNames={['result']}
        onHide={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('row', { name: /result/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'result' })).not.toBeInTheDocument()
  })

  it('should combine reserved-name and duplicate-name issues into one warning per user output', async () => {
    const user = userEvent.setup()
    const outputParameters: WorkflowToolDrawerPayload['outputParameters'] = [
      {
        name: 'text',
        description: 'Success output',
        source: { nodeId: 'end-success', nodeTitle: 'Output', outputIndex: 0 },
      },
      {
        name: 'text',
        description: 'Fallback output',
        source: { nodeId: 'end-fallback', nodeTitle: 'Output', outputIndex: 0 },
      },
    ]

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({ outputParameters })}
        onHide={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    const issueWarnings = screen.getAllByRole('button', {
      name: 'text',
    })
    expect(issueWarnings).toHaveLength(2)

    await user.click(issueWarnings[0]!)

    const issueDetails = (await screen.findAllByRole('dialog')).find((dialog) =>
      within(dialog).queryByText('tools.createTool.toolOutput.reservedParameterDuplicateTip'),
    )!
    expect(issueDetails).toHaveTextContent(
      'tools.createTool.toolOutput.reservedParameterDuplicateTip',
    )
    expect(issueDetails).toHaveTextContent('workflow.errorMsg.duplicateOutputVariable')
    expect(issueDetails).toHaveTextContent('Output (1/2)')
    expect(issueDetails).toHaveTextContent('Output (2/2)')
    expect(issueDetails).not.toHaveTextContent('end-succ')
    expect(issueDetails).not.toHaveTextContent('end-fall')

    expect(screen.getByRole('row', { name: /Output \(1\/2\).*Success output/ })).toBeInTheDocument()
    expect(
      screen.getByRole('row', { name: /Output \(2\/2\).*Fallback output/ }),
    ).toBeInTheDocument()

    const reservedOutputRow = screen.getByRole('row', {
      name: /text.*tools\.createTool\.toolOutput\.reserved.*string/,
    })
    expect(within(reservedOutputRow).queryByRole('button')).not.toBeInTheDocument()
  })

  it('should keep schema-derived outputs compact when source metadata is unavailable', () => {
    render(
      <WorkflowToolDrawer
        payload={createPayload({
          outputParameters: undefined,
          tool: {
            output_schema: {
              type: 'object',
              properties: {
                answer: {
                  type: 'string',
                  description: 'Published answer',
                },
              },
            },
          },
        })}
        onHide={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('row', { name: /answer string Published answer/ })).toBeInTheDocument()
    expect(screen.queryByText('tools.createTool.toolOutput.sourceNode')).not.toBeInTheDocument()
  })
})
