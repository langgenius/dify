import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

describe('context-menu wrapper', () => {
  describe('ContextMenuContent', () => {
    it('should position content at bottom-start with default placement when props are omitted', () => {
      render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent positionerProps={{ 'role': 'group', 'aria-label': 'content positioner' }}>
            <ContextMenuItem>Content action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const positioner = screen.getByRole('group', { name: 'content positioner' })
      const popup = screen.getByRole('menu')
      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(within(popup).getByRole('menuitem', { name: 'Content action' })).toBeInTheDocument()
    })

    it('should apply custom placement when custom positioning props are provided', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'custom content positioner' })
      const popup = screen.getByRole('menu')
      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(within(popup).getByRole('menuitem', { name: 'Custom content' })).toBeInTheDocument()
    })

    it('should forward passthrough attributes and handlers when positionerProps and popupProps are provided', () => {
      const handlePositionerMouseEnter = vi.fn()
      const handlePopupClick = vi.fn()

      render(
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

      const positioner = screen.getByRole('group', { name: 'context content positioner' })
      const popup = screen.getByRole('menu')
      fireEvent.mouseEnter(positioner)
      fireEvent.click(popup)
      expect(positioner).toHaveAttribute('id', 'context-content-positioner')
      expect(popup).toHaveAttribute('id', 'context-content-popup')
      expect(handlePositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('ContextMenuSubContent', () => {
    it('should position sub-content at right-start with default placement when props are omitted', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'sub positioner' })
      expect(positioner).toHaveAttribute('data-side', 'right')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(screen.getByRole('menuitem', { name: 'Sub action' })).toBeInTheDocument()
    })
  })

  describe('destructive prop behavior', () => {
    it.each([true, false])('should remain interactive and not leak destructive prop on item when destructive is %s', (destructive) => {
      const handleClick = vi.fn()

      render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              destructive={destructive}
              aria-label="menu action"
              id={`context-item-${String(destructive)}`}
              onClick={handleClick}
            >
              Item label
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const item = screen.getByRole('menuitem', { name: 'menu action' })
      fireEvent.click(item)
      expect(item).toHaveAttribute('id', `context-item-${String(destructive)}`)
      expect(item).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it.each([true, false])('should remain interactive and not leak destructive prop on submenu trigger when destructive is %s', (destructive) => {
      const handleClick = vi.fn()

      render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuSub open>
              <ContextMenuSubTrigger
                destructive={destructive}
                aria-label="submenu action"
                id={`context-sub-${String(destructive)}`}
                onClick={handleClick}
              >
                Trigger item
              </ContextMenuSubTrigger>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const trigger = screen.getByRole('menuitem', { name: 'submenu action' })
      fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('id', `context-sub-${String(destructive)}`)
      expect(trigger).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it.each([true, false])('should remain interactive and not leak destructive prop on link item when destructive is %s', (destructive) => {
      render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLinkItem
              destructive={destructive}
              href="https://example.com/docs"
              aria-label="context docs link"
              id={`context-link-${String(destructive)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </ContextMenuLinkItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const link = screen.getByRole('menuitem', { name: 'context docs link' })
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('id', `context-link-${String(destructive)}`)
      expect(link).not.toHaveAttribute('destructive')
    })
  })

  describe('ContextMenuLinkItem close behavior', () => {
    it('should keep link semantics and not leak closeOnClick prop when closeOnClick is false', () => {
      render(
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

      const link = screen.getByRole('menuitem', { name: 'docs link' })
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link).toHaveAttribute('href', 'https://example.com/docs')
      expect(link).not.toHaveAttribute('closeOnClick')
    })
  })

  describe('ContextMenuTrigger interaction', () => {
    it('should open menu when right-clicking trigger area', () => {
      render(
        <ContextMenu>
          <ContextMenuTrigger aria-label="context trigger area">
            Trigger area
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Open on right click</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      const trigger = screen.getByLabelText('context trigger area')
      fireEvent.contextMenu(trigger)
      expect(screen.getByRole('menuitem', { name: 'Open on right click' })).toBeInTheDocument()
    })
  })

  describe('ContextMenuSeparator', () => {
    it('should render separator and keep surrounding rows when separator is between items', () => {
      render(
        <ContextMenu open>
          <ContextMenuTrigger aria-label="context trigger">Open</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>First action</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Second action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      )

      expect(screen.getByRole('menuitem', { name: 'First action' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Second action' })).toBeInTheDocument()
      expect(screen.getAllByRole('separator')).toHaveLength(1)
    })
  })
})
