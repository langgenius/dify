import type { ConversationHistoriesRole } from '@/models/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import EditModal from './edit-modal'

vi.mock('@/app/components/base/modal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('Conversation history edit modal', () => {
  const data: ConversationHistoriesRole = {
    user_prefix: 'user',
    assistant_prefix: 'assistant',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render provided prefixes', () => {
    render(<EditModal isShow saveLoading={false} data={data} onClose={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByDisplayValue('user')).toBeInTheDocument()
    expect(screen.getByDisplayValue('assistant')).toBeInTheDocument()
  })

  it('should update prefixes and save changes', () => {
    const onSave = vi.fn()
    render(<EditModal isShow saveLoading={false} data={data} onClose={vi.fn()} onSave={onSave} />)

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
    render(<EditModal isShow saveLoading={false} data={data} onClose={onClose} onSave={vi.fn()} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
