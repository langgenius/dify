import type { HumanInputNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'
import { DeliveryMethodType, UserActionButtonType } from '../types'

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Delivery configuration has its own interaction suite; these cases exercise panel-owned controls.
vi.mock('../components/delivery-method', () => ({ default: () => null }))
// Keep the rich editor runtime outside this panel composition test.
vi.mock('../components/form-content', () => ({
  default: ({
    value,
    onChange,
    readonly,
  }: {
    value: string
    onChange: (value: string) => void
    readonly: boolean
  }) => (
    <textarea
      aria-label="Form content"
      value={value}
      readOnly={readonly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const createData = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [
    {
      id: 'dm-webapp',
      type: DeliveryMethodType.WebApp,
      enabled: true,
    },
  ],
  form_content: 'Please review this request',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'review_result',
      default: {
        selector: [],
        type: 'constant',
        value: '',
      },
    },
  ],
  user_actions: [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
  ],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

const renderPanel = (data = createData(), readOnly = false) =>
  renderNodePanel(Panel, data, { initialStoreState: { canvasReadOnly: readOnly } })

describe('human-input/panel', () => {
  it('persists action additions, edits, deletion and timeout changes', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(data().user_actions).toEqual([
      createData().user_actions[0],
      {
        id: 'action_2',
        title: 'Button Text 2',
        button_style: UserActionButtonType.Default,
      },
    ])
    const title = screen.getByDisplayValue<HTMLInputElement>('Approve')
    await user.click(title)
    title.select()
    await user.paste('Accept request')
    expect(data().user_actions[0]).toEqual({
      id: 'approve',
      title: 'Accept request',
      button_style: UserActionButtonType.Primary,
    })
    await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
    expect(data().user_actions).toEqual([
      { id: 'action_2', title: 'Button Text 2', button_style: UserActionButtonType.Default },
    ])
    expect(screen.queryByDisplayValue('Accept request')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.hours' }),
    )
    expect(data()).toMatchObject({ timeout: 3, timeout_unit: 'hour' })
  })

  it('copies form content, expands the editor and opens and closes the real preview', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(copy).toHaveBeenCalledWith('Please review this request')
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')

    await user.click(screen.getByRole('button', { name: 'share.chat.expand' }))
    await user.click(screen.getByRole('button', { name: 'share.chat.collapse' }))
    expect(screen.getByRole('button', { name: 'share.chat.expand' })).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.formContent.preview',
      }),
    )
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.editor.previewTip'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(
      screen.queryByText('workflowHumanInput.nodes.humanInput.editor.previewTip'),
    ).not.toBeInTheDocument()
  })

  it('prevents edits in readonly mode', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData(), true)

    expect(screen.getByRole('textbox', { name: 'Form content' })).toHaveAttribute('readonly')
    expect(screen.getByDisplayValue('Approve')).toBeDisabled()
    expect(screen.getByDisplayValue('approve')).toBeDisabled()
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }),
    ).toBeDisabled()
    const hours = screen.getByRole('radio', {
      name: 'workflowHumanInput.nodes.humanInput.timeout.hours',
    })
    expect(hours).toBeDisabled()
    await user.click(hours)
    expect(data()).toMatchObject(createData())
    expect(screen.queryByRole('button', { name: 'common.operation.add' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.formContent.preview',
      }),
    ).not.toBeInTheDocument()
  })

  it('offers the first action when the action list is empty', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData({ user_actions: [] }))
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.userActions.emptyTip'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(data().user_actions).toEqual([
      {
        id: 'action_1',
        title: 'Button Text 1',
        button_style: UserActionButtonType.Default,
      },
    ])
  })

  it('exposes file-aware input outputs alongside action metadata', async () => {
    const user = userEvent.setup()
    renderPanel(
      createData({
        inputs: [
          {
            type: InputVarType.singleFile,
            output_variable_name: 'attachment',
            allowed_file_extensions: [],
            allowed_file_types: [],
            allowed_file_upload_methods: [],
          },
          {
            type: InputVarType.multiFiles,
            output_variable_name: 'attachments',
            allowed_file_extensions: [],
            allowed_file_types: [],
            allowed_file_upload_methods: [],
            number_limits: 3,
          },
        ],
      }),
    )
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('attachment')).toBeInTheDocument()
    expect(screen.getByText('file', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('attachments')).toBeInTheDocument()
    expect(screen.getByText('array[file]', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('__action_id')).toBeInTheDocument()
    expect(screen.getByText('__action_value')).toBeInTheDocument()
    expect(screen.getByText('__rendered_content')).toBeInTheDocument()
  })
})
