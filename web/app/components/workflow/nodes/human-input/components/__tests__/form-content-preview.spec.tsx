import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withSelectorKey } from '@/test/i18n-mock'
import { UserActionButtonType } from '../../types'
import FormContentPreview from '../form-content-preview'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())
const mockGetButtonStyle = vi.hoisted(() => vi.fn())
const mockPreview = vi.hoisted(() => vi.fn())
const mockSyncDraft = vi.hoisted(() => vi.fn())
const mockApp = { id: 'app-1', mode: 'workflow' }
vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: typeof mockApp }) => unknown) =>
    selector({ appDetail: mockApp }),
}))
vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ doSyncWorkflowDraft: mockSyncDraft }),
}))
vi.mock('@/service/client', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        workflows: {
          draft: {
            humanInput: { nodes: { byNodeId: { form: { preview: { post: mockPreview } } } } },
          },
        },
      },
    },
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { panelWidth: number }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/base/badge', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div data-testid="badge">{children}</div>,
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/utils', () => ({
  getButtonStyle: (...args: unknown[]) => mockGetButtonStyle(...args),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({
    content,
    customComponents,
  }: {
    content: string
    customComponents: {
      variable: (props: { node: { properties: { dataPath: string } } }) => ReactNode
      section: (props: { node: { properties: { dataName: string } } }) => ReactNode
    }
  }) => (
    <div>
      <p>{content}</p>
      {customComponents.variable({ node: { properties: { dataPath: '#node-1.answer#' } } })}
      {customComponents.section({ node: { properties: { dataName: 'field_1' } } })}
      {customComponents.section({ node: { properties: { dataName: 'missing_field' } } })}
    </div>
  ),
}))

vi.mock('../variable-in-markdown', () => ({
  rehypeNotes: vi.fn(),
  rehypeVariable: vi.fn(),
  Variable: ({ path }: { path: string }) => <div data-testid="variable-path">{path}</div>,
  Note: ({
    input,
    nodeName,
  }: {
    input: {
      type: string
      default?: { selector: string[] }
      option_source?: { selector: string[] }
    }
    nodeName: (nodeId: string) => string
  }) => (
    <div data-testid="note">
      {input.default?.selector?.length
        ? nodeName(input.default.selector[0]!)
        : input.option_source?.selector?.join('.') || input.type}
    </div>
  ),
}))

describe('FormContentPreview', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncDraft.mockResolvedValue({})
    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
    mockUseStore.mockImplementation((selector: (state: { panelWidth: number }) => unknown) =>
      selector({ panelWidth: 320 }),
    )
    mockUseNodes.mockReturnValue([
      {
        id: 'node-1',
        data: { title: 'Classifier' },
      },
    ])
    mockGetButtonStyle.mockImplementation((style: UserActionButtonType) => style.toLowerCase())
  })

  it('should render preview content with resolved node names, note fallbacks, and action buttons', () => {
    const { container } = render(
      <FormContentPreview
        content="content"
        formInputs={[
          {
            type: 'text-input' as never,
            output_variable_name: 'field_1',
            default: {
              type: 'variable',
              selector: ['node-1', 'answer'],
              value: '',
            },
          },
        ]}
        userActions={[
          {
            id: 'approve',
            title: 'Approve',
            button_style: UserActionButtonType.Primary,
          },
        ]}
        onClose={onClose}
      />,
    )

    expect(container.firstChild)!.toHaveStyle({ right: '328px' })
    expect(screen.getByTestId('badge'))!.toHaveTextContent('nodes.humanInput.formContent.preview')
    expect(screen.getByTestId('variable-path'))!.toHaveTextContent('#Classifier.answer#')
    expect(screen.getByTestId('note'))!.toHaveTextContent('Classifier')
    expect(screen.getByText(/Can't find note:/))!.toHaveTextContent('missing_field')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByText('nodes.humanInput.editor.previewTip'))!.toBeInTheDocument()
  })

  it('should close the preview when the close action is clicked', () => {
    render(
      <FormContentPreview content="content" formInputs={[]} userActions={[]} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should pass non-paragraph inputs through the preview note renderer', () => {
    render(
      <FormContentPreview
        content="content"
        formInputs={[
          {
            type: 'select' as never,
            output_variable_name: 'field_1',
            option_source: {
              type: 'variable',
              selector: ['node-1', 'items'],
              value: [],
            },
          },
        ]}
        userActions={[]}
        onClose={onClose}
      />,
    )

    expect(screen.getByTestId('note')).toHaveTextContent('node-1.items')
  })
  it('loads the V2 preview from the saved workflow and displays server content', async () => {
    mockPreview.mockResolvedValue({
      form_content: 'Resolved server preview',
      inputs: [],
      actions: [],
    })
    render(
      <FormContentPreview
        nodeId="node-1"
        content="Unsaved local content"
        formInputs={[]}
        userActions={[]}
        onClose={onClose}
      />,
    )
    expect(await screen.findByText('Resolved server preview')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved local content')).not.toBeInTheDocument()
    expect(mockSyncDraft).toHaveBeenCalledOnce()
    expect(mockPreview).toHaveBeenCalledWith({
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: { inputs: {} },
    })
  })

  it('shows a failed server preview and retries without displaying local content as a result', async () => {
    const user = userEvent.setup()
    mockPreview
      .mockRejectedValueOnce(new Error('Server preview failed'))
      .mockResolvedValue({ form_content: 'Retried preview', inputs: [], actions: [] })
    render(
      <FormContentPreview
        nodeId="node-1"
        content="Local draft"
        formInputs={[]}
        userActions={[]}
        onClose={onClose}
      />,
    )
    expect(await screen.findByText('Server preview failed')).toBeInTheDocument()
    expect(screen.queryByText('Local draft')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'operation.retry' }))
    expect(await screen.findByText('Retried preview')).toBeInTheDocument()
  })
  it('uses historical props for a read-only V2 preview without fetching the current draft', () => {
    render(
      <FormContentPreview
        nodeId="node-1"
        readOnly
        content="Historical form content"
        formInputs={[]}
        userActions={[]}
        onClose={onClose}
      />,
    )
    expect(screen.getByText('Historical form content')).toBeInTheDocument()
    expect(mockPreview).not.toHaveBeenCalled()
    expect(mockSyncDraft).not.toHaveBeenCalled()
  })
})
