import type { HumanInputV2NodeType } from '../types'
import type useHumanInputV2Config from '../use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { HumanInputV2Panel } from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockSharedPanel = vi.hoisted(() => vi.fn())

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
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(config)
  })

  it('composes v2 sections with shared fields and never renders Delivery Method', async () => {
    const user = userEvent.setup()
    render(
      <HumanInputV2Panel
        id="human-input-v2"
        data={data}
        panelProps={{} as NodePanelProps<HumanInputV2NodeType>['panelProps']}
      />,
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
