import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ItemOperation from '../index'

describe('ItemOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (overrides: Partial<React.ComponentProps<typeof ItemOperation>> = {}) => {
    const props: React.ComponentProps<typeof ItemOperation> = {
      itemName: 'My App',
      isPinned: false,
      togglePin: vi.fn(),
      ...overrides,
    }
    return {
      props,
      ...render(<ItemOperation {...props} />),
    }
  }

  describe('Rendering', () => {
    it('should distinguish operation triggers by item name', () => {
      render(
        <>
          <ItemOperation itemName="First App" isPinned={false} togglePin={vi.fn()} />
          <ItemOperation itemName="Second App" isPinned={false} togglePin={vi.fn()} />
        </>,
      )

      expect(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*First App/ }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*Second App/ }),
      ).toBeInTheDocument()
    })

    it('should render pin action when menu is open', async () => {
      const user = userEvent.setup()
      renderComponent()

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )

      expect(await screen.findByText('explore.sidebar.action.pin')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render rename action when isShowRenameConversation is true', async () => {
      const user = userEvent.setup()
      renderComponent({ isShowRenameConversation: true })

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )

      expect(await screen.findByText('explore.sidebar.action.rename')).toBeInTheDocument()
    })

    it('should render unpin label when isPinned is true', async () => {
      const user = userEvent.setup()
      renderComponent({ isPinned: true })

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )

      expect(await screen.findByText('explore.sidebar.action.unpin')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call togglePin when clicking pin action', async () => {
      const user = userEvent.setup()
      const { props } = renderComponent()

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )
      await user.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(props.togglePin).toHaveBeenCalledTimes(1)
    })

    it('should call onRenameConversation when clicking rename action', async () => {
      const user = userEvent.setup()
      const onRenameConversation = vi.fn()
      renderComponent({
        isShowRenameConversation: true,
        onRenameConversation,
      })

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )
      await user.click(await screen.findByText('explore.sidebar.action.rename'))

      expect(onRenameConversation).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should keep the menu open after rerender', async () => {
      const user = userEvent.setup()
      const { props, rerender } = renderComponent()
      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )
      await screen.findByText('explore.sidebar.action.pin')

      rerender(<ItemOperation {...props} />)

      expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
    })

    it('should stop propagation when clicking menu actions', async () => {
      const user = userEvent.setup()
      const onParentClick = vi.fn()
      const togglePin = vi.fn()

      render(
        <div onClick={onParentClick}>
          <ItemOperation itemName="My App" isPinned={false} togglePin={togglePin} />
        </div>,
      )

      await user.click(
        screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
      )
      await user.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(togglePin).toHaveBeenCalledTimes(1)
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})
