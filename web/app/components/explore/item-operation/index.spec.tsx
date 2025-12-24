import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ItemOperation from './index'

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

  // Rendering: menu items show after opening.
  describe('Rendering', () => {
    it('should render pin and delete actions when menu is open', async () => {
      // Arrange
      renderComponent()

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      // Assert
      expect(await screen.findByText('explore.sidebar.action.pin')).toBeInTheDocument()
      expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
    })
  })

  // Props: render optional rename action and pinned label text.
  describe('Props', () => {
    it('should render rename action when isShowRenameConversation is true', async () => {
      // Arrange
      renderComponent({ isShowRenameConversation: true })

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      // Assert
      expect(await screen.findByText('explore.sidebar.action.rename')).toBeInTheDocument()
    })

    it('should render unpin label when isPinned is true', async () => {
      // Arrange
      renderComponent({ isPinned: true })

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      // Assert
      expect(await screen.findByText('explore.sidebar.action.unpin')).toBeInTheDocument()
    })
  })

  // User interactions: clicking action items triggers callbacks.
  describe('User Interactions', () => {
    it('should call togglePin when clicking pin action', async () => {
      // Arrange
      const { props } = renderComponent()

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      // Assert
      expect(props.togglePin).toHaveBeenCalledTimes(1)
    })

    it('should call onDelete when clicking delete action', async () => {
      // Arrange
      const { props } = renderComponent()

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      // Assert
      expect(props.onDelete).toHaveBeenCalledTimes(1)
    })
  })

  // Edge cases: menu closes after mouse leave when no hovering state remains.
  describe('Edge Cases', () => {
    it('should close the menu when mouse leaves the panel and item is not hovering', async () => {
      // Arrange
      renderComponent()
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      const pinText = await screen.findByText('explore.sidebar.action.pin')
      const menu = pinText.closest('div')?.parentElement as HTMLElement

      // Act
      fireEvent.mouseEnter(menu)
      fireEvent.mouseLeave(menu)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('explore.sidebar.action.pin')).not.toBeInTheDocument()
      })
    })
  })
})
