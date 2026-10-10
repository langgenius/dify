import type { ConversationHistoriesRole } from '@/models/debug'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { EditModal } from '../edit-modal'

describe('Conversation history edit modal', () => {
  const data: ConversationHistoriesRole = {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render provided prefixes', () => {
    render(<EditModal open data={data} onOpenChange={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('user')).toBeInTheDocument()
    expect(screen.getByDisplayValue('assistant')).toBeInTheDocument()
  })

  it('should update prefixes and save changes', () => {
    const onSave = vi.fn()
    render(<EditModal open data={data} onOpenChange={vi.fn()} onSave={onSave} />)

    fireEvent.change(screen.getByDisplayValue('user'), { target: { value: 'member' } })
    fireEvent.change(screen.getByDisplayValue('assistant'), { target: { value: 'helper' } })
    fireEvent.click(screen.getByText('common.operation.save'))

    expect(onSave).toHaveBeenCalledWith({
      user_prefix: 'member',
      assistant_prefix: 'helper',
    })
  })

  it('should call close handler', () => {
    const onClose = vi.fn()
    render(<EditModal open data={data} onOpenChange={onClose} onSave={vi.fn()} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

it('submits labeled prefixes with Enter and starts a fresh draft after cancellation', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const data = { user_prefix: 'user', assistant_prefix: 'assistant' }
  function Owner() {
    const [open, setOpen] = React.useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Edit prefixes
        </button>
        <EditModal
          open={open}
          onOpenChange={setOpen}
          data={data}
          onSave={(value) => {
            onSave(value)
            setOpen(false)
          }}
        />
      </>
    )
  }
  render(<Owner />)
  await user.click(screen.getByRole('button', { name: 'Edit prefixes' }))
  const prefix = screen.getByRole('textbox', {
    name: 'appDebug.feature.conversationHistory.editModal.userPrefix',
  })
  await user.clear(prefix)
  await user.type(prefix, 'discard')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Edit prefixes' }))
  const freshPrefix = screen.getByRole('textbox', {
    name: 'appDebug.feature.conversationHistory.editModal.userPrefix',
  })
  expect(freshPrefix).toHaveValue('user')
  await user.clear(freshPrefix)
  await user.type(freshPrefix, 'member{Enter}')
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    user_prefix: 'member',
    assistant_prefix: 'assistant',
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
