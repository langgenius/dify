import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as ReactI18next from 'react-i18next'
import RenameModal from '../rename-modal'

vi.mock('@/app/components/base/modal', () => ({
  default: ({
    title,
    isShow,
    children,
  }: {
    title: ReactNode
    isShow: boolean
    children: ReactNode
  }) => {
    if (!isShow)
      return null
    return (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    )
  },
}))

describe('RenameModal', () => {
  const defaultProps = {
    isShow: true,
    saveLoading: false,
    name: 'Original Name',
    onClose: vi.fn(),
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title, label, input and action buttons', () => {
    render(<RenameModal {...defaultProps} />)

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
    expect(screen.getByText('common.chat.conversationName')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.chat.conversationNamePlaceholder')).toHaveValue('Original Name')
    expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    expect(screen.getByText('common.operation.save')).toBeInTheDocument()
  })

  it('does not render when isShow is false', () => {
    render(<RenameModal {...defaultProps} isShow={false} />)
    expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
  })

  it('calls onClose when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    await user.click(screen.getByText('common.operation.cancel'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('calls onSave with updated name', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Updated Name')
    await user.click(screen.getByText('common.operation.save'))

    expect(defaultProps.onSave).toHaveBeenCalledWith('Updated Name')
  })

  it('calls onSave with initial name when unchanged', async () => {
    const user = userEvent.setup()
    render(<RenameModal {...defaultProps} />)

    await user.click(screen.getByText('common.operation.save'))
    expect(defaultProps.onSave).toHaveBeenCalledWith('Original Name')
  })

  it('shows loading state when saveLoading is true', () => {
    render(<RenameModal {...defaultProps} saveLoading />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('hides loading state when saveLoading is false', () => {
    render(<RenameModal {...defaultProps} saveLoading={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps edited name when parent rerenders with different name prop', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameModal {...defaultProps} name="First" />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Edited')

    rerender(<RenameModal {...defaultProps} name="Second" />)
    expect(screen.getByRole('textbox')).toHaveValue('Edited')
  })

  it('retains typed state after isShow false then true on same component instance', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RenameModal {...defaultProps} isShow />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Changed')

    rerender(<RenameModal {...defaultProps} isShow={false} />)
    rerender(<RenameModal {...defaultProps} isShow />)

    expect(screen.getByRole('textbox')).toHaveValue('Changed')
  })

  it('uses empty placeholder fallback when translation returns empty string', () => {
    const originalUseTranslation = ReactI18next.useTranslation
    const useTranslationSpy = vi.spyOn(ReactI18next, 'useTranslation').mockImplementation((...args) => {
      const translation = originalUseTranslation(...args)
      return {
        ...translation,
        t: ((key: string, options?: Record<string, unknown>) => {
          if (key === 'chat.conversationNamePlaceholder')
            return ''
          const ns = options?.ns as string | undefined
          return ns ? `${ns}.${key}` : key
        }) as typeof translation.t,
      }
    })

    try {
      render(<RenameModal {...defaultProps} />)
      expect(screen.getByPlaceholderText('')).toBeInTheDocument()
    }
    finally {
      useTranslationSpy.mockRestore()
    }
  })
})
