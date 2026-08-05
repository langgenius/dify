import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ItemOperation from '../index'

describe('ItemOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (overrides: Partial<React.ComponentProps<typeof ItemOperation>> = {}) => {
    const props: React.ComponentProps<typeof ItemOperation> = {
      isPinned: false,
      isShowDelete: true,
      togglePin: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }
    return {
      props,
      ...render(<ItemOperation {...props} />),
    }
  }

  describe('Rendering', () => {
    it('should render pin and delete actions when menu is open', async () => {
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByText('explore.sidebar.action.pin')).toBeInTheDocument()
      expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render rename action when isShowRenameConversation is true', async () => {
      renderComponent({ isShowRenameConversation: true })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByText('explore.sidebar.action.rename')).toBeInTheDocument()
    })

    it('should render unpin label when isPinned is true', async () => {
      renderComponent({ isPinned: true })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByText('explore.sidebar.action.unpin')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call togglePin when clicking pin action', async () => {
      const { props } = renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(props.togglePin).toHaveBeenCalledTimes(1)
    })

    it('should call onDelete when clicking delete action', async () => {
      const { props } = renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(props.onDelete).toHaveBeenCalledTimes(1)
    })

    it('should call onRenameConversation when clicking rename action', async () => {
      const onRenameConversation = vi.fn()
      renderComponent({
        isShowRenameConversation: true,
        onRenameConversation,
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByText('explore.sidebar.action.rename'))

      expect(onRenameConversation).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should keep the menu open after rerender', async () => {
      const { props, rerender } = renderComponent()
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await screen.findByText('explore.sidebar.action.pin')

      rerender(<ItemOperation {...props} />)

      expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
    })

    it('should stop propagation when clicking menu actions', async () => {
      const onParentClick = vi.fn()
      const togglePin = vi.fn()

      render(
        <div onClick={onParentClick}>
          <ItemOperation isPinned={false} isShowDelete togglePin={togglePin} onDelete={vi.fn()} />
        </div>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(togglePin).toHaveBeenCalledTimes(1)
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})
