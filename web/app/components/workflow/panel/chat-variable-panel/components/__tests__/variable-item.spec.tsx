import type { ConversationVariable } from '@/app/components/workflow/types'
import { fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatVarType } from '../../type'
import VariableItem from '../variable-item'

const createVariable = (overrides: Partial<ConversationVariable> = {}): ConversationVariable => ({
  id: 'var-1',
  name: 'conversation_var',
  description: 'Conversation scoped variable',
  value_type: ChatVarType.String,
  value: '',
  ...overrides,
})

describe('VariableItem', () => {
  it('updates destructive state on hover and fires edit/delete actions', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const { container } = render(
      <VariableItem
        item={createVariable()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )

    const card = container.firstElementChild as HTMLDivElement
    const actions = container.querySelectorAll('.cursor-pointer')
    fireEvent.mouseOver(actions[1] as Element)
    expect(card.className).toContain('border-state-destructive-border')
    fireEvent.mouseOut(actions[1] as Element)
    expect(card.className).not.toContain('border-state-destructive-border')

    const icons = container.querySelectorAll('svg')
    await user.click(icons[1] as SVGElement)
    await user.click(icons[2] as SVGElement)

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-1' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-1' }))
  })
})
