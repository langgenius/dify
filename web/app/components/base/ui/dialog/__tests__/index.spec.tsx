import type { ComponentPropsWithoutRef } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../index'

type DivPrimitiveProps = ComponentPropsWithoutRef<'div'>
type ButtonPrimitiveProps = ComponentPropsWithoutRef<'button'>
type SectionPrimitiveProps = ComponentPropsWithoutRef<'section'>

vi.mock('@base-ui/react/dialog', () => {
  const createDivPrimitive = () => {
    return vi.fn(({ children, ...props }: DivPrimitiveProps) => (
      <div {...props}>
        {children}
      </div>
    ))
  }

  const createButtonPrimitive = () => {
    return vi.fn(({ children, ...props }: ButtonPrimitiveProps) => (
      <button type="button" {...props}>
        {children}
      </button>
    ))
  }

  const createPopupPrimitive = () => {
    return vi.fn(({ children, ...props }: SectionPrimitiveProps) => (
      <section role="dialog" {...props}>
        {children}
      </section>
    ))
  }

  return {
    Dialog: {
      Root: createDivPrimitive(),
      Trigger: createDivPrimitive(),
      Title: createDivPrimitive(),
      Description: createDivPrimitive(),
      Close: createButtonPrimitive(),
      Portal: createDivPrimitive(),
      Backdrop: createDivPrimitive(),
      Popup: createPopupPrimitive(),
    },
  }
})

describe('Dialog wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for wrapper-specific structure and content.
  describe('Rendering', () => {
    it('should render portal structure and dialog content when DialogContent is rendered', () => {
      // Arrange
      const contentText = 'dialog body'

      // Act
      render(
        <DialogContent>
          <span>{contentText}</span>
        </DialogContent>,
      )

      // Assert
      expect(vi.mocked(BaseDialog.Portal)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(BaseDialog.Backdrop)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(BaseDialog.Popup)).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(contentText)).toBeInTheDocument()
    })
  })

  // Props behavior for closable semantics and defaults.
  describe('Props', () => {
    it('should not render close button when closable is omitted', () => {
      // Arrange
      render(
        <DialogContent>
          <span>content</span>
        </DialogContent>,
      )

      // Assert
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should not render close button when closable is false', () => {
      // Arrange
      render(
        <DialogContent closable={false}>
          <span>content</span>
        </DialogContent>,
      )

      // Assert
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should render semantic close button when closable is true', () => {
      // Arrange
      render(
        <DialogContent closable>
          <span>content</span>
        </DialogContent>,
      )

      // Assert
      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toHaveAttribute('aria-label', 'Close')
      expect(screen.getByRole('dialog')).toContainElement(closeButton)

      const closeIcon = closeButton.querySelector('span')
      expect(closeIcon).toBeInTheDocument()
      expect(closeButton).toContainElement(closeIcon)
    })
  })

  // Export mapping ensures wrapper aliases point to base primitives.
  describe('Exports', () => {
    it('should map dialog aliases to the matching base dialog primitives', () => {
      // Arrange
      const basePrimitives = BaseDialog

      // Act & Assert
      expect(Dialog).toBe(basePrimitives.Root)
      expect(DialogTrigger).toBe(basePrimitives.Trigger)
      expect(DialogTitle).toBe(basePrimitives.Title)
      expect(DialogDescription).toBe(basePrimitives.Description)
      expect(DialogClose).toBe(basePrimitives.Close)
    })
  })
})
