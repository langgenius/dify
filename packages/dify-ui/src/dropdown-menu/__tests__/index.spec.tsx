import { render } from 'vitest-browser-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../index'

const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

describe('dropdown-menu wrapper', () => {
  describe('DropdownMenuContent', () => {
    it('should position content at bottom-end with default placement when props are omitted', async () => {
      const screen = await renderWithSafeViewport(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent positionerProps={{ 'role': 'group', 'aria-label': 'content positioner' }}>
            <DropdownMenuItem>Content action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'content positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'content positioner' })).toHaveAttribute('data-align', 'end')
      await expect.element(screen.getByRole('menuitem', { name: 'Content action' })).toBeInTheDocument()
    })

    it('should apply custom placement when custom positioning props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent
            placement="top-start"
            sideOffset={12}
            alignOffset={-3}
            positionerProps={{ 'role': 'group', 'aria-label': 'custom content positioner' }}
          >
            <DropdownMenuItem>Custom content</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'custom content positioner' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('group', { name: 'custom content positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('menuitem', { name: 'Custom content' })).toBeInTheDocument()
    })

    it('should forward passthrough attributes and handlers when positionerProps and popupProps are provided', async () => {
      const handlePositionerMouseEnter = vi.fn()
      const handlePopupClick = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'dropdown content positioner',
              'id': 'dropdown-content-positioner',
              'onMouseEnter': handlePositionerMouseEnter,
            }}
            popupProps={{
              role: 'menu',
              id: 'dropdown-content-popup',
              onClick: handlePopupClick,
            }}
          >
            <DropdownMenuItem>Passthrough content</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await screen.getByRole('group', { name: 'dropdown content positioner' }).hover()
      await screen.getByRole('menu').click()

      await expect.element(screen.getByRole('group', { name: 'dropdown content positioner' })).toHaveAttribute('id', 'dropdown-content-positioner')
      await expect.element(screen.getByRole('menu')).toHaveAttribute('id', 'dropdown-content-popup')
      expect(handlePositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSubContent', () => {
    it('should position sub-content at left-start with default placement when props are omitted', async () => {
      const screen = await renderWithSafeViewport(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent positionerProps={{ 'role': 'group', 'aria-label': 'sub positioner' }}>
                <DropdownMenuItem>Sub action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'sub positioner' })).toHaveAttribute('data-side', 'left')
      await expect.element(screen.getByRole('group', { name: 'sub positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('menuitem', { name: 'Sub action' })).toBeInTheDocument()
    })

    it('should apply custom placement and forward passthrough props for sub-content when custom props are provided', async () => {
      const handlePositionerFocus = vi.fn()
      const handlePopupClick = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                placement="right-end"
                sideOffset={6}
                alignOffset={2}
                positionerProps={{
                  'role': 'group',
                  'aria-label': 'dropdown sub positioner',
                  'id': 'dropdown-sub-positioner',
                  'onFocus': handlePositionerFocus,
                }}
                popupProps={{
                  role: 'menu',
                  id: 'dropdown-sub-popup',
                  onClick: handlePopupClick,
                }}
              >
                <DropdownMenuItem>Custom sub action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      screen.getByRole('group', { name: 'dropdown sub positioner' }).element().dispatchEvent(new FocusEvent('focus', {
        bubbles: true,
      }))
      await screen.getByRole('menu', { name: 'More actions' }).click()

      await expect.element(screen.getByRole('group', { name: 'dropdown sub positioner' })).toHaveAttribute('data-side', 'right')
      await expect.element(screen.getByRole('group', { name: 'dropdown sub positioner' })).toHaveAttribute('data-align', 'end')
      await expect.element(screen.getByRole('group', { name: 'dropdown sub positioner' })).toHaveAttribute('id', 'dropdown-sub-positioner')
      await expect.element(screen.getByRole('menu', { name: 'More actions' })).toHaveAttribute('id', 'dropdown-sub-popup')
      expect(handlePositionerFocus).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSubTrigger', () => {
    it('should render submenu trigger content when trigger children are provided', async () => {
      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>Trigger item</DropdownMenuSubTrigger>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await expect.element(screen.getByRole('menuitem', { name: 'Trigger item' })).toBeInTheDocument()
    })

    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant on submenu trigger when variant is %s', async (variant) => {
      const handleClick = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger
                variant={variant}
                aria-label="submenu action"
                id={`submenu-trigger-${variant}`}
                onClick={handleClick}
              >
                Trigger item
              </DropdownMenuSubTrigger>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await screen.getByRole('menuitem', { name: 'submenu action' }).click()
      await expect.element(screen.getByRole('menuitem', { name: 'submenu action' })).toHaveAttribute('id', `submenu-trigger-${variant}`)
      await expect.element(screen.getByRole('menuitem', { name: 'submenu action' })).toHaveAttribute('data-variant', variant)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuItem', () => {
    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant when variant is %s', async (variant) => {
      const handleClick = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              variant={variant}
              aria-label="menu action"
              id={`menu-item-${variant}`}
              onClick={handleClick}
            >
              Item label
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await screen.getByRole('menuitem', { name: 'menu action' }).click()
      await expect.element(screen.getByRole('menuitem', { name: 'menu action' })).toHaveAttribute('id', `menu-item-${variant}`)
      await expect.element(screen.getByRole('menuitem', { name: 'menu action' })).toHaveAttribute('data-variant', variant)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuLinkItem', () => {
    it('should render as anchor and keep href/target attributes when link props are provided', async () => {
      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLinkItem href="https://example.com/docs" target="_blank" rel="noopener noreferrer">
              Docs
            </DropdownMenuLinkItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'Docs' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('href', 'https://example.com/docs')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should keep link semantics and not leak closeOnClick prop when closeOnClick is false', async () => {
      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLinkItem
              href="https://example.com/docs"
              closeOnClick={false}
              aria-label="docs link"
            >
              Docs
            </DropdownMenuLinkItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'docs link' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('href', 'https://example.com/docs')
      expect(link).not.toHaveAttribute('closeOnClick')
    })

    it('should preserve link semantics when render prop uses a custom anchor element', async () => {
      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLinkItem
              render={<a href="/account" />}
              aria-label="account link"
            >
              Account settings
            </DropdownMenuLinkItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'account link' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('href', '/account')
      expect(link).toHaveTextContent('Account settings')
    })

    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant when variant is %s', async (variant) => {
      const handleClick = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLinkItem
              variant={variant}
              href="https://example.com/docs"
              aria-label="docs link"
              id={`menu-link-${variant}`}
              onClick={(event) => {
                event.preventDefault()
                handleClick(event)
              }}
            >
              Docs
            </DropdownMenuLinkItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await screen.getByRole('menuitem', { name: 'docs link' }).click()

      const link = screen.getByRole('menuitem', { name: 'docs link' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('id', `menu-link-${variant}`)
      expect(link).toHaveAttribute('data-variant', variant)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSeparator', () => {
    it('should forward passthrough props and handlers when separator props are provided', async () => {
      const handleMouseEnter = vi.fn()

      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSeparator
              aria-label="actions divider"
              id="menu-separator"
              onMouseEnter={handleMouseEnter}
            />
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      screen.getByRole('separator', { name: 'actions divider' }).element().dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true,
      }))
      await expect.element(screen.getByRole('separator', { name: 'actions divider' })).toHaveAttribute('id', 'menu-separator')
      expect(handleMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should keep surrounding menu rows rendered when separator is placed between items', async () => {
      const screen = await render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>First action</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Second action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      await expect.element(screen.getByRole('menuitem', { name: 'First action' })).toBeInTheDocument()
      await expect.element(screen.getByRole('menuitem', { name: 'Second action' })).toBeInTheDocument()
      expect(screen.getByRole('separator').elements()).toHaveLength(1)
    })
  })
})
