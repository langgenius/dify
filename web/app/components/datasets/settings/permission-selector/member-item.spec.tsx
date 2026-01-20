import { fireEvent, render, screen } from '@testing-library/react'
import MemberItem from './member-item'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('MemberItem', () => {
  const defaultProps = {
    leftIcon: <span data-testid="avatar-icon">Avatar</span>,
    name: 'John Doe',
    email: 'john@example.com',
    isSelected: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MemberItem {...defaultProps} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should render left icon (avatar)', () => {
      render(<MemberItem {...defaultProps} />)
      expect(screen.getByTestId('avatar-icon')).toBeInTheDocument()
    })

    it('should render member name', () => {
      render(<MemberItem {...defaultProps} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should render member email', () => {
      render(<MemberItem {...defaultProps} />)
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })
  })

  describe('Selection State', () => {
    it('should show checkmark icon when selected', () => {
      render(<MemberItem {...defaultProps} isSelected={true} />)
      const container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should not show checkmark icon when not selected', () => {
      render(<MemberItem {...defaultProps} isSelected={false} />)
      const container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).not.toBeInTheDocument()
    })

    it('should apply opacity class to checkmark when isMe is true', () => {
      render(<MemberItem {...defaultProps} isSelected={true} isMe={true} />)
      const container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).toHaveClass('opacity-30')
    })
  })

  describe('isMe Flag', () => {
    it('should show me indicator when isMe is true', () => {
      render(<MemberItem {...defaultProps} isMe={true} />)
      // The translation key is 'form.me' which will be rendered by the mock
      expect(screen.getByText(/form\.me/)).toBeInTheDocument()
    })

    it('should not show me indicator when isMe is false', () => {
      render(<MemberItem {...defaultProps} isMe={false} />)
      expect(screen.queryByText(/form\.me/)).not.toBeInTheDocument()
    })

    it('should not show me indicator by default', () => {
      render(<MemberItem {...defaultProps} />)
      expect(screen.queryByText(/form\.me/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<MemberItem {...defaultProps} onClick={handleClick} />)

      const item = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      fireEvent.click(item!)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onClick is not provided', () => {
      render(<MemberItem {...defaultProps} />)

      const item = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      expect(() => fireEvent.click(item!)).not.toThrow()
    })

    it('should have cursor-pointer class for interactivity', () => {
      render(<MemberItem {...defaultProps} />)
      const item = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      expect(item).toHaveClass('cursor-pointer')
    })
  })

  describe('Props', () => {
    it('should render different names', () => {
      const names = ['Alice', 'Bob', 'Charlie']

      names.forEach((name) => {
        const { unmount } = render(<MemberItem {...defaultProps} name={name} />)
        expect(screen.getByText(name)).toBeInTheDocument()
        unmount()
      })
    })

    it('should render different emails', () => {
      const emails = ['alice@test.com', 'bob@company.org', 'charlie@domain.net']

      emails.forEach((email) => {
        const { unmount } = render(<MemberItem {...defaultProps} email={email} />)
        expect(screen.getByText(email)).toBeInTheDocument()
        unmount()
      })
    })

    it('should render different left icons', () => {
      const customIcon = <img data-testid="custom-avatar" alt="avatar" />
      render(<MemberItem {...defaultProps} leftIcon={customIcon} />)
      expect(screen.getByTestId('custom-avatar')).toBeInTheDocument()
    })

    it('should handle isSelected toggle correctly', () => {
      const { rerender } = render(<MemberItem {...defaultProps} isSelected={false} />)

      // Initially not selected
      let container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      expect(container?.querySelector('svg')).not.toBeInTheDocument()

      // Update to selected
      rerender(<MemberItem {...defaultProps} isSelected={true} />)
      container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      expect(container?.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty name', () => {
      render(<MemberItem {...defaultProps} name="" />)
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })

    it('should handle empty email', () => {
      render(<MemberItem {...defaultProps} email="" />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should handle long name with truncation', () => {
      const longName = 'A'.repeat(100)
      render(<MemberItem {...defaultProps} name={longName} />)
      const nameElement = screen.getByText(longName)
      expect(nameElement).toHaveClass('truncate')
    })

    it('should handle long email with truncation', () => {
      const longEmail = `${'a'.repeat(50)}@${'b'.repeat(50)}.com`
      render(<MemberItem {...defaultProps} email={longEmail} />)
      const emailElement = screen.getByText(longEmail)
      expect(emailElement).toHaveClass('truncate')
    })

    it('should handle special characters in name', () => {
      const specialName = 'O\'Connor-Smith'
      render(<MemberItem {...defaultProps} name={specialName} />)
      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle unicode characters', () => {
      const unicodeName = '张三'
      const unicodeEmail = '张三@example.com'
      render(<MemberItem {...defaultProps} name={unicodeName} email={unicodeEmail} />)
      expect(screen.getByText(unicodeName)).toBeInTheDocument()
      expect(screen.getByText(unicodeEmail)).toBeInTheDocument()
    })

    it('should render both isMe and isSelected together', () => {
      render(<MemberItem {...defaultProps} isMe={true} isSelected={true} />)
      expect(screen.getByText(/form\.me/)).toBeInTheDocument()
      const container = screen.getByText('John Doe').closest('div')?.parentElement?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
      expect(checkIcon).toHaveClass('opacity-30')
    })
  })
})
