import type { HumanInputV2NodeType } from '../types'
import type useHumanInputV2Config from '../use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { HumanInputV2Panel } from '../panel'

const mockHitlIm = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return mockHitlIm.enabled
  },
}))

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockSharedPanel = vi.hoisted(() => vi.fn())

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['test-current-user-profile'],
    queryFn: async () => ({ profile: { email: 'reviewer@example.com' } }),
  }),
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))
vi.mock('@/app/components/workflow/nodes/human-input/shared/panel-sections', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockSharedPanel(props)
    return <div>shared-human-input-sections</div>
  },
}))
vi.mock('../components/recipients', () => ({
  __esModule: true,
  default: (props: { onChange: (value: HumanInputV2NodeType['recipients_spec']) => void }) => (
    <button type="button" onClick={() => props.onChange([{ type: 'initiator' }])}>
      recipients-section
    </button>
  ),
}))
vi.mock('../components/message-template', () => ({
  __esModule: true,
  default: (props: { onChange: (value: HumanInputV2NodeType['message_template']) => void }) => (
    <button type="button" onClick={() => props.onChange({ subject: 'Subject', body: 'Body' })}>
      message-template-section
    </button>
  ),
}))
vi.mock('../components/debug-mode', () => ({
  __esModule: true,
  default: (props: { onChange: (value: HumanInputV2NodeType['debug_mode']) => void }) => (
    <button type="button" onClick={() => props.onChange({ enabled: true, channels: ['email'] })}>
      debug-mode-section
    </button>
  ),
}))

const data: HumanInputV2NodeType = {
  type: BlockEnum.HumanInput,
  version: '2',
  title: 'Human Input v2',
  desc: '',
  recipients_spec: [],
  message_template: { subject: '', body: '' },
  debug_mode: { enabled: false, channels: [] },
  form_content: '',
  inputs: [],
  user_actions: [],
  timeout: 36,
  timeout_unit: 'hour',
}

const config = {
  readOnly: false,
  inputs: data,
  editorKey: 0,
  structuredOutputCollapsed: true,
  setStructuredOutputCollapsed: vi.fn(),
  handleRecipientsChange: vi.fn(),
  handleMessageTemplateChange: vi.fn(),
  handleDebugModeChange: vi.fn(),
  handleUserActionAdd: vi.fn(),
  handleUserActionChange: vi.fn(),
  handleUserActionDelete: vi.fn(),
  handleTimeoutChange: vi.fn(),
  handleFormContentChange: vi.fn(),
  handleFormInputsChange: vi.fn(),
  handleFormInputItemRename: vi.fn(),
  handleFormInputItemRemove: vi.fn(),
} satisfies ReturnType<typeof useHumanInputV2Config>

describe('Human Input v2 panel composition', () => {
  beforeEach(() => {
    mockHitlIm.enabled = true
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(config)
  })

  it('composes v2 sections with shared fields and never renders Delivery Method', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HumanInputV2Panel
          id="human-input-v2"
          data={data}
          panelProps={{} as NodePanelProps<HumanInputV2NodeType>['panelProps']}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText('shared-human-input-sections')).toBeInTheDocument()
    expect(screen.queryByText(/delivery method/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'recipients-section' }))
    await user.click(screen.getByRole('button', { name: 'message-template-section' }))
    await user.click(screen.getByRole('button', { name: 'debug-mode-section' }))
    expect(config.handleRecipientsChange).toHaveBeenCalledWith([{ type: 'initiator' }])
    expect(config.handleMessageTemplateChange).toHaveBeenCalledWith({
      subject: 'Subject',
      body: 'Body',
    })
    expect(config.handleDebugModeChange).toHaveBeenCalledWith({
      enabled: true,
      channels: ['email'],
    })
    expect(mockSharedPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'human-input-v2', config }),
    )
  })
})

it('keeps a stored v2 panel unavailable without mounting editable recipient or template flows while disabled', () => {
  mockHitlIm.enabled = false
  const stored = {
    ...data,
    recipients_spec: [
      { type: 'contact', contact_id: 'stored-contact' },
    ] as HumanInputV2NodeType['recipients_spec'],
    message_template: { subject: 'Stored subject', body: 'Stored {{#url#}}' },
  }
  const original = structuredClone(stored)
  render(
    <HumanInputV2Panel
      id="human-input-v2"
      data={stored}
      panelProps={{} as NodePanelProps<HumanInputV2NodeType>['panelProps']}
    />,
  )

  expect(screen.getByRole('status')).toHaveTextContent('workflow.nodes.humanInputV2.disabled')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText('recipients-section')).not.toBeInTheDocument()
  expect(screen.queryByText('message-template-section')).not.toBeInTheDocument()
  expect(screen.queryByText('debug-mode-section')).not.toBeInTheDocument()
  expect(config.handleRecipientsChange).not.toHaveBeenCalled()
  expect(config.handleMessageTemplateChange).not.toHaveBeenCalled()
  expect(config.handleDebugModeChange).not.toHaveBeenCalled()
  expect(stored).toEqual(original)
})
