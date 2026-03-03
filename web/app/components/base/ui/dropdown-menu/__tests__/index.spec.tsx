import { Menu } from '@base-ui/react/menu'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../index'

describe('dropdown-menu wrapper', () => {
  describe('alias exports', () => {
    it('should map direct aliases to the corresponding Menu primitive when importing menu roots', () => {
      expect(DropdownMenu).toBe(Menu.Root)
      expect(DropdownMenuPortal).toBe(Menu.Portal)
      expect(DropdownMenuTrigger).toBe(Menu.Trigger)
      expect(DropdownMenuSub).toBe(Menu.SubmenuRoot)
      expect(DropdownMenuGroup).toBe(Menu.Group)
      expect(DropdownMenuRadioGroup).toBe(Menu.RadioGroup)
    })
  })

  describe('DropdownMenuContent', () => {
    it('should position content at bottom-end with default placement when props are omitted', () => {
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent positionerProps={{ 'role': 'group', 'aria-label': 'content positioner' }}>
            <DropdownMenuItem>Content action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const positioner = screen.getByRole('group', { name: 'content positioner' })
      const popup = screen.getByRole('menu')

      expect(positioner).toHaveAttribute('data-side', 'bottom')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(within(popup).getByRole('menuitem', { name: 'Content action' })).toBeInTheDocument()
    })

    it('should apply custom placement when custom positioning props are provided', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'custom content positioner' })
      const popup = screen.getByRole('menu')

      expect(positioner).toHaveAttribute('data-side', 'top')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(within(popup).getByRole('menuitem', { name: 'Custom content' })).toBeInTheDocument()
    })

    it('should forward passthrough attributes and handlers when positionerProps and popupProps are provided', () => {
      const handlePositionerMouseEnter = vi.fn()
      const handlePopupClick = vi.fn()

      render(
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

      const positioner = screen.getByRole('group', { name: 'dropdown content positioner' })
      const popup = screen.getByRole('menu')
      fireEvent.mouseEnter(positioner)
      fireEvent.click(popup)

      expect(positioner).toHaveAttribute('id', 'dropdown-content-positioner')
      expect(popup).toHaveAttribute('id', 'dropdown-content-popup')
      expect(handlePositionerMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSubContent', () => {
    it('should position sub-content at left-start with default placement when props are omitted', () => {
      render(
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

      const positioner = screen.getByRole('group', { name: 'sub positioner' })
      expect(positioner).toHaveAttribute('data-side', 'left')
      expect(positioner).toHaveAttribute('data-align', 'start')
      expect(screen.getByRole('menuitem', { name: 'Sub action' })).toBeInTheDocument()
    })

    it('should apply custom placement and forward passthrough props for sub-content when custom props are provided', () => {
      const handlePositionerFocus = vi.fn()
      const handlePopupClick = vi.fn()

      render(
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

      const positioner = screen.getByRole('group', { name: 'dropdown sub positioner' })
      const popup = screen.getByRole('menu', { name: 'More actions' })
      fireEvent.focus(positioner)
      fireEvent.click(popup)

      expect(positioner).toHaveAttribute('data-side', 'right')
      expect(positioner).toHaveAttribute('data-align', 'end')
      expect(positioner).toHaveAttribute('id', 'dropdown-sub-positioner')
      expect(popup).toHaveAttribute('id', 'dropdown-sub-popup')
      expect(handlePositionerFocus).toHaveBeenCalledTimes(1)
      expect(handlePopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSubTrigger', () => {
    it('should render submenu trigger content when trigger children are provided', () => {
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>Trigger item</DropdownMenuSubTrigger>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      expect(screen.getByRole('menuitem', { name: 'Trigger item' })).toBeInTheDocument()
    })

    it.each([true, false])('should remain interactive and not leak destructive prop when destructive is %s', (destructive) => {
      const handleClick = vi.fn()

      render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger
                destructive={destructive}
                aria-label="submenu action"
                id={`submenu-trigger-${String(destructive)}`}
                onClick={handleClick}
              >
                Trigger item
              </DropdownMenuSubTrigger>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const subTrigger = screen.getByRole('menuitem', { name: 'submenu action' })
      fireEvent.click(subTrigger)

      expect(subTrigger).toHaveAttribute('id', `submenu-trigger-${String(destructive)}`)
      expect(subTrigger).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuItem', () => {
    it.each([true, false])('should remain interactive and not leak destructive prop when destructive is %s', (destructive) => {
      const handleClick = vi.fn()

      render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              destructive={destructive}
              aria-label="menu action"
              id={`menu-item-${String(destructive)}`}
              onClick={handleClick}
            >
              Item label
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      const item = screen.getByRole('menuitem', { name: 'menu action' })
      fireEvent.click(item)

      expect(item).toHaveAttribute('id', `menu-item-${String(destructive)}`)
      expect(item).not.toHaveAttribute('destructive')
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuSeparator', () => {
    it('should forward passthrough props and handlers when separator props are provided', () => {
      const handleMouseEnter = vi.fn()

      render(
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

      const separator = screen.getByRole('separator', { name: 'actions divider' })
      fireEvent.mouseEnter(separator)

      expect(separator).toHaveAttribute('id', 'menu-separator')
      expect(handleMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should keep surrounding menu rows rendered when separator is placed between items', () => {
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger aria-label="menu trigger">Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>First action</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Second action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      )

      expect(screen.getByRole('menuitem', { name: 'First action' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Second action' })).toBeInTheDocument()
      expect(screen.getAllByRole('separator')).toHaveLength(1)
    })
  })
})
