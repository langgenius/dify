import { render } from 'vitest-browser-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLinkItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../index'

const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

describe('context-menu wrapper', () => {
  describe('ContextMenuContent', () => {
    it('should position content at bottom-start with default placement when props are omitted', async () => {
      const screen = await renderWithSafeViewport(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent positionerProps={{ 'role': 'group', 'aria-label': 'content positioner' }}>
            <ContextMenuItem>Content action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'content positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'content positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('menuitem', { name: 'Content action' })).toBeInTheDocument()
    })

    it('should apply custom top placement and keep point-anchor alignment stable when custom positioning props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent
            placement="top-end"
            sideOffset={12}
            alignOffset={-3}
            positionerProps={{ 'role': 'group', 'aria-label': 'custom content positioner' }}
          >
            <ContextMenuItem>Custom content</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'custom content positioner' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('group', { name: 'custom content positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('menuitem', { name: 'Custom content' })).toBeInTheDocument()
    })

    it('should forward passthrough attributes and handlers when positionerProps and popupProps are provided', async () => {
      const handlePositionerMouseEnter = vi.fn()
      const handlePopupClick = vi.fn()

      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'context content positioner',
              'id': 'context-content-positioner',
              'onMouseEnter': handlePositionerMouseEnter,
            }}
            popupProps={{
              role: 'menu',
              id: 'context-content-popup',
              onClick: handlePopupClick,
            }}
          >
            <ContextMenuItem>Passthrough content</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await screen.getByRole('group', { name: 'context content positioner' }).hover()
      await screen.getByRole('menu').click()

      await expect.element(screen.getByRole('group', { name: 'context content positioner' })).toHaveAttribute('id', 'context-content-positioner')
      await expect.element(screen.getByRole('menu')).toHaveAttribute('id', 'context-content-popup')
      expect(handlePositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('ContextMenuSubContent', () => {
    it('should position sub-content at right-start with default placement when props are omitted', async () => {
      const screen = await renderWithSafeViewport(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuSub open>
              <ContextMenuSubTrigger>More actions</ContextMenuSubTrigger>
              <ContextMenuSubContent positionerProps={{ 'role': 'group', 'aria-label': 'sub positioner' }}>
                <ContextMenuItem>Sub action</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await expect.element(screen.getByRole('group', { name: 'sub positioner' })).toHaveAttribute('data-side', 'right')
      await expect.element(screen.getByRole('group', { name: 'sub positioner' })).toHaveAttribute('data-align', 'start')
      await expect.element(screen.getByRole('menuitem', { name: 'Sub action' })).toBeInTheDocument()
    })
  })

  describe('variant prop behavior', () => {
    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant on item when variant is %s', async (variant) => {
      const handleClick = vi.fn()

      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              variant={variant}
              aria-label="menu action"
              id={`context-item-${variant}`}
              onClick={handleClick}
            >
              Item label
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await screen.getByRole('menuitem', { name: 'menu action' }).click()
      await expect.element(screen.getByRole('menuitem', { name: 'menu action' })).toHaveAttribute('id', `context-item-${variant}`)
      await expect.element(screen.getByRole('menuitem', { name: 'menu action' })).toHaveAttribute('data-variant', variant)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant on submenu trigger when variant is %s', async (variant) => {
      const handleClick = vi.fn()

      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuSub open>
              <ContextMenuSubTrigger
                variant={variant}
                aria-label="submenu action"
                id={`context-sub-${variant}`}
                onClick={handleClick}
              >
                Trigger item
              </ContextMenuSubTrigger>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await screen.getByRole('menuitem', { name: 'submenu action' }).click()
      await expect.element(screen.getByRole('menuitem', { name: 'submenu action' })).toHaveAttribute('id', `context-sub-${variant}`)
      await expect.element(screen.getByRole('menuitem', { name: 'submenu action' })).toHaveAttribute('data-variant', variant)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it.each(['default', 'destructive'] as const)('should remain interactive and set data-variant on link item when variant is %s', async (variant) => {
      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLinkItem
              variant={variant}
              href="https://example.com/docs"
              aria-label="context docs link"
              id={`context-link-${variant}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </ContextMenuLinkItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'context docs link' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('id', `context-link-${variant}`)
      expect(link).toHaveAttribute('data-variant', variant)
    })
  })

  describe('ContextMenuLinkItem close behavior', () => {
    it('should keep link semantics and not leak closeOnClick prop when closeOnClick is false', async () => {
      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLinkItem
              href="https://example.com/docs"
              closeOnClick={false}
              aria-label="docs link"
            >
              Docs
            </ContextMenuLinkItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'docs link' }).element()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('href', 'https://example.com/docs')
      expect(link).not.toHaveAttribute('closeOnClick')
    })
  })

  describe('ContextMenuTrigger interaction', () => {
    it('should open menu when right-clicking trigger area', async () => {
      const screen = await render(
        <ContextMenu>
          <ContextMenuTrigger aria-label="context trigger area">
            Trigger area
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Open on right click</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      screen.getByLabelText('context trigger area').element().dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
      }))

      await expect.element(screen.getByRole('menuitem', { name: 'Open on right click' })).toBeInTheDocument()
    })
  })

  describe('ContextMenuSeparator', () => {
    it('should render separator and keep surrounding rows when separator is between items', async () => {
      const screen = await render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>First action</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Second action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      await expect.element(screen.getByRole('menuitem', { name: 'First action' })).toBeInTheDocument()
      await expect.element(screen.getByRole('menuitem', { name: 'Second action' })).toBeInTheDocument()
      expect(screen.getByRole('separator').elements()).toHaveLength(1)
    })
  })
})
