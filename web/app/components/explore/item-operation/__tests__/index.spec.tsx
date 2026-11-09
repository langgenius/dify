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
  })

  describe('User Interactions', () => {
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
    it.each([false, true])(
      'toggles pin without activating the parent when pinned is %s',
      async (isPinned) => {
        const user = userEvent.setup()
        const onParentClick = vi.fn()
        const togglePin = vi.fn()

        render(
          <div onClick={onParentClick}>
            <ItemOperation itemName="My App" isPinned={isPinned} togglePin={togglePin} />
          </div>,
        )

        await user.click(
          screen.getByRole('button', { name: /common\.operation\.moreActionsFor.*My App/ }),
        )
        await user.click(
          await screen.findByRole('menuitem', {
            name: isPinned ? 'explore.sidebar.action.unpin' : 'explore.sidebar.action.pin',
          }),
        )

        expect(togglePin).toHaveBeenCalledTimes(1)
        expect(onParentClick).not.toHaveBeenCalled()
      },
    )
  })
})
