import type { ConversationHistoriesRole } from '@/models/debug'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditModal from '../edit-modal'

describe('Conversation history edit modal', () => {
  const data: ConversationHistoriesRole = {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update prefixes and save changes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditModal isShow saveLoading={false} data={data} onClose={vi.fn()} onSave={onSave} />)

    const userInput = screen.getByDisplayValue('user')
    await user.clear(userInput)
    await user.type(userInput, 'member')
    const assistantInput = screen.getByDisplayValue('assistant')
    await user.clear(assistantInput)
    await user.type(assistantInput, 'helper')
    await user.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      user_prefix: 'member',
      assistant_prefix: 'helper',
    })
  })

  it('should call close handler', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditModal isShow saveLoading={false} data={data} onClose={onClose} onSave={vi.fn()} />)

    await user.click(screen.getByText('common.operation.cancel'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
