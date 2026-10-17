import type { ConversationItem } from '@/models/share'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Item from '../item'

const item: ConversationItem = {
  id: 'conversation-1',
  name: 'Test Conversation',
  inputs: {},
  introduction: '',
}
const createProps = () => ({
  item,
  onOperate: vi.fn(),
  onChangeConversation: vi.fn(),
  currentConversationId: 'other',
})

async function openMenu(user: ReturnType<typeof userEvent.setup>, name = item.name) {
  await user.hover(screen.getByRole('button', { name }))
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
}

describe('Conversation sidebar item', () => {
  it('selects the conversation by mouse and keyboard and exposes its full title', async () => {
    const user = userEvent.setup()
    const props = createProps()
    render(<Item {...props} />)
    const conversation = screen.getByRole('button', { name: item.name })
    expect(conversation).toHaveAttribute('title', item.name)
    await user.click(conversation)
    expect(props.onChangeConversation).toHaveBeenCalledExactlyOnceWith(item.id)
    await user.keyboard('{Enter}')
    expect(props.onChangeConversation).toHaveBeenCalledTimes(2)
    expect(props.onOperate).not.toHaveBeenCalled()
  })

  it.each(['rename', 'delete'] as const)(
    'performs %s through the menu without changing conversations',
    async (operation) => {
      const user = userEvent.setup()
      const props = createProps()
      render(<Item {...props} />)
      await openMenu(user)
      await user.click(
        screen.getByRole('menuitem', { name: `explore.sidebar.action.${operation}` }),
      )
      await waitFor(() => expect(props.onOperate).toHaveBeenCalledExactlyOnceWith(operation, item))
      expect(props.onChangeConversation).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    },
  )

  it('changes the menu action from pin to unpin when pin state updates', async () => {
    const user = userEvent.setup()
    const props = createProps()
    const { rerender } = render(<Item {...props} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    expect(props.onOperate).toHaveBeenNthCalledWith(1, 'pin', item)
    rerender(<Item {...props} isPin />)
    await openMenu(user)
    expect(
      screen.queryByRole('menuitem', { name: 'explore.sidebar.action.pin' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    expect(props.onOperate).toHaveBeenNthCalledWith(2, 'unpin', item)
    expect(props.onChangeConversation).not.toHaveBeenCalled()
  })

  it('uses the updated conversation and callbacks after reusing the row', async () => {
    const user = userEvent.setup()
    const props = createProps()
    const { rerender } = render(<Item {...props} />)
    const next = { ...item, id: 'conversation-2', name: 'Updated Conversation' }
    const onOperate = vi.fn()
    const onChangeConversation = vi.fn()
    rerender(
      <Item
        {...props}
        item={next}
        onOperate={onOperate}
        onChangeConversation={onChangeConversation}
        currentConversationId={next.id}
      />,
    )
    expect(screen.queryByRole('button', { name: item.name })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.more' })).toHaveAttribute(
      'data-active',
    )
    await user.click(screen.getByRole('button', { name: next.name }))
    expect(onChangeConversation).toHaveBeenCalledExactlyOnceWith(next.id)
    await openMenu(user, next.name)
    await user.click(screen.getByRole('menuitem', { name: 'explore.sidebar.action.delete' }))
    await waitFor(() => expect(onOperate).toHaveBeenCalledExactlyOnceWith('delete', next))
    expect(props.onOperate).not.toHaveBeenCalled()
    expect(props.onChangeConversation).not.toHaveBeenCalled()
  })

  it('omits operations for an unsaved conversation but still allows selecting it', async () => {
    const props = createProps()
    render(<Item {...props} item={{ ...item, id: '' }} />)
    expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: item.name }))
    expect(props.onChangeConversation).toHaveBeenCalledExactlyOnceWith('')
  })

  it('opens operations from the keyboard and dismisses them without selecting a conversation', async () => {
    const user = userEvent.setup()
    const props = createProps()
    render(<Item {...props} />)
    await user.tab()
    expect(screen.getByRole('button', { name: item.name })).toHaveFocus()
    await user.tab()
    const more = screen.getByRole('button', { name: 'common.operation.more' })
    expect(more).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(more).toHaveFocus()
    expect(props.onOperate).not.toHaveBeenCalled()
    expect(props.onChangeConversation).not.toHaveBeenCalled()
  })
})
