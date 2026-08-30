import type {
  DifyBuilderActionResponse,
  DifyBuilderConversationItemResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DifyBuilderConversation } from '../conversation'

const conversationItem = (
  seq: number,
  kind: string,
  payload: Record<string, unknown> = {},
): DifyBuilderConversationItemResponse => ({
  seq,
  kind,
  payload,
  at_version: 1,
})

const action = (id: string, label: string, kind = 'primary'): DifyBuilderActionResponse => ({
  id,
  label,
  kind,
})

const renderConversation = (
  items: DifyBuilderConversationItemResponse[],
  actions: DifyBuilderActionResponse[] = [],
  onAction = vi.fn(async () => true),
  busy = false,
) => {
  render(
    <DifyBuilderConversation
      items={items}
      actions={actions}
      busy={busy}
      interrupted={false}
      checklistPayload={{ passed: true, remaining: [] }}
      onAction={onAction}
    />,
  )
  return onAction
}

describe('DifyBuilderConversation', () => {
  it('renders only one thinking indicator when the latest assistant turn is pending', () => {
    renderConversation([conversationItem(1, 'assistant_turn')], [], undefined, true)

    expect(screen.getAllByText('workflow.difyBuilder.thinking')).toHaveLength(1)
  })

  it('keeps invalidated forms read-only and submits values from the latest live form', async () => {
    const user = userEvent.setup()
    const onAction = renderConversation(
      [
        conversationItem(1, 'form', {
          fields: [{ key: 'old', label: 'Old value', type: 'text' }],
          values: { old: 'historic' },
        }),
        conversationItem(2, 'assistant_turn', {
          reply_text: 'Old requirements',
          cards: ['form'],
          card_state: 'invalidated',
        }),
        conversationItem(3, 'form', {
          fields: [{ key: 'current', label: 'Current value', type: 'text' }],
          values: { current: 'draft' },
        }),
        conversationItem(4, 'assistant_turn', {
          reply_text: 'Current requirements',
          cards: ['form'],
        }),
      ],
      [action('submit_requirements', 'Submit')],
    )

    expect(screen.getByText('workflow.difyBuilder.invalidated')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Old value' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Current value' }))
    await user.type(screen.getByRole('textbox', { name: 'Current value' }), 'updated')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onAction).toHaveBeenCalledWith('submit_requirements', { current: 'updated' })
  })

  it('expands only the active change card without posting a client-only action', async () => {
    const user = userEvent.setup()
    const onAction = renderConversation(
      [
        conversationItem(1, 'change_set', {
          count: 1,
          changes: ['Historic LLM change'],
          scope: 'historic configuration',
        }),
        conversationItem(2, 'change_set', {
          count: 1,
          changes: ['Current LLM change'],
          scope: 'current configuration',
        }),
      ],
      [action('view_changes', 'View changes', 'secondary')],
    )

    const viewChanges = screen.getByRole('button', { name: 'View changes' })
    expect(viewChanges).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Historic LLM change')).not.toBeInTheDocument()
    expect(screen.queryByText('Current LLM change')).not.toBeInTheDocument()
    await user.click(viewChanges)

    expect(viewChanges).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Historic LLM change')).not.toBeInTheDocument()
    expect(screen.getByText('Current LLM change')).toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('keeps server actions on the latest live decision card', async () => {
    const user = userEvent.setup()
    const onAction = renderConversation(
      [
        conversationItem(1, 'plan', { title: 'Old plan', items: [] }),
        conversationItem(2, 'assistant_turn', {
          reply_text: 'Old proposal',
          cards: ['plan'],
          card_state: 'invalidated',
        }),
        conversationItem(3, 'plan', { title: 'Current plan', items: [] }),
        conversationItem(4, 'assistant_turn', {
          reply_text: 'Current proposal',
          cards: ['plan'],
        }),
      ],
      [action('approve_plan', 'Approve plan')],
    )

    expect(screen.getAllByRole('button', { name: 'Approve plan' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Approve plan' }))

    expect(onAction).toHaveBeenCalledWith('approve_plan', {})
  })
})
