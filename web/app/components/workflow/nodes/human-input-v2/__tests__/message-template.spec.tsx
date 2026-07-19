import type { ComponentProps } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MessageTemplate from '../components/message-template'

vi.mock(
  '@/app/components/workflow/nodes/human-input/components/delivery-method/mail-body-input',
  () => ({
    __esModule: true,
    default: ({
      value,
      onChange,
      readOnly,
    }: {
      value: string
      onChange: (value: string) => void
      readOnly: boolean
    }) => (
      <textarea
        aria-label="message-body-editor"
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  }),
)

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: { onChange: (value: string[]) => void }) => (
    <button
      type="button"
      aria-label="insert-subject-variable"
      onClick={() => props.onChange(['start', 'email'])}
    />
  ),
}))

const renderTemplate = (overrides: Partial<ComponentProps<typeof MessageTemplate>> = {}) => {
  const props: ComponentProps<typeof MessageTemplate> = {
    nodeId: 'human-input-v2',
    value: { subject: 'Original subject', body: 'Original body' },
    onChange: vi.fn(),
    readonly: false,
    availableVars: [],
    availableNodes: [],
    ...overrides,
  }
  return { ...render(<MessageTemplate {...props} />), props }
}

const openTemplate = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('workflow.nodes.humanInputV2.template.title'))
}

describe('Human Input v2 Message Template', () => {
  it('opens from node data, inserts variables, and commits subject/body atomically', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    await openTemplate(user)

    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    const body = screen.getByLabelText('message-body-editor')
    expect(subject).toHaveValue('Original subject')
    expect(body).toHaveValue('Original body')

    await user.click(screen.getByRole('button', { name: 'insert-subject-variable' }))
    expect(subject).toHaveValue('Original subject{{#start.email#}}')
    await user.clear(body)
    await user.type(body, 'Updated body without a request URL')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(props.onChange).toHaveBeenCalledTimes(1)
    expect(props.onChange).toHaveBeenCalledWith({
      subject: 'Original subject{{#start.email#}}',
      body: 'Updated body without a request URL',
    })
  })

  it('discards local drafts on Cancel and Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    renderTemplate()
    await openTemplate(user)
    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    await user.clear(subject)
    await user.type(subject, 'Unsaved')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() =>
      expect(
        screen.getByText('workflow.nodes.humanInputV2.template.title').closest('button'),
      ).toHaveFocus(),
    )
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )

    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Discard with Escape',
    )
    await user.keyboard('{Escape}')
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )
  })

  it('validates both local fields and does not submit twice', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    await openTemplate(user)
    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.clear(screen.getByLabelText('message-body-editor'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(props.onChange).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Subject',
    )
    await user.type(screen.getByLabelText('message-body-editor'), 'Body')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    await user.dblClick(save)
    expect(props.onChange).toHaveBeenCalledTimes(1)
  })

  it('opens a non-mutating read-only view', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate({ readonly: true })
    await openTemplate(user)

    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()
    expect(screen.getByLabelText('message-body-editor')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()
  })
})
