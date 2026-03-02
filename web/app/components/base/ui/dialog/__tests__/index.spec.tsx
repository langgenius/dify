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

type PrimitiveProps = ComponentPropsWithoutRef<'div'>

vi.mock('@base-ui/react/dialog', () => {
  const createPrimitive = (testId: string) => {
    return vi.fn(({ children, ...props }: PrimitiveProps) => (
      <div data-testid={testId} {...props}>
        {children}
      </div>
    ))
  }

  return {
    Dialog: {
      Root: createPrimitive('base-dialog-root'),
      Trigger: createPrimitive('base-dialog-trigger'),
      Title: createPrimitive('base-dialog-title'),
      Description: createPrimitive('base-dialog-description'),
      Close: createPrimitive('base-dialog-close'),
      Portal: createPrimitive('base-dialog-portal'),
      Backdrop: createPrimitive('base-dialog-backdrop'),
      Popup: createPrimitive('base-dialog-popup'),
    },
  }
})

describe('Dialog wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for wrapper-specific structure and content.
  describe('Rendering', () => {
    it('should render backdrop and popup when DialogContent is rendered', () => {
      // Arrange
      const contentText = 'dialog body'

      // Act
      render(
        <DialogContent>
          <span>{contentText}</span>
        </DialogContent>,
      )

      // Assert
      expect(screen.getByTestId('base-dialog-portal')).toBeInTheDocument()
      expect(screen.getByTestId('base-dialog-backdrop')).toBeInTheDocument()
      expect(screen.getByTestId('base-dialog-popup')).toBeInTheDocument()
      expect(screen.getByText(contentText)).toBeInTheDocument()
    })

    it('should apply default wrapper class names when no override classes are provided', () => {
      // Arrange
      render(
        <DialogContent>
          <span>content</span>
        </DialogContent>,
      )

      // Act
      const backdrop = screen.getByTestId('base-dialog-backdrop')
      const popup = screen.getByTestId('base-dialog-popup')

      // Assert
      expect(backdrop).toHaveClass('fixed', 'inset-0', 'z-50', 'bg-background-overlay')
      expect(backdrop).toHaveClass('transition-opacity', 'duration-150')
      expect(backdrop).toHaveClass('data-[ending-style]:opacity-0', 'data-[starting-style]:opacity-0')

      expect(popup).toHaveClass('fixed', 'left-1/2', 'top-1/2', 'z-50')
      expect(popup).toHaveClass('max-h-[80dvh]', 'w-[480px]', 'max-w-[calc(100vw-2rem)]')
      expect(popup).toHaveClass('-translate-x-1/2', '-translate-y-1/2')
      expect(popup).toHaveClass('rounded-2xl', 'border-[0.5px]', 'bg-components-panel-bg', 'p-6', 'shadow-xl')
      expect(popup).toHaveClass('transition-all', 'duration-150')
      expect(popup).toHaveClass(
        'data-[ending-style]:scale-95',
        'data-[starting-style]:scale-95',
        'data-[ending-style]:opacity-0',
        'data-[starting-style]:opacity-0',
      )
    })
  })

  // Props behavior for class merging and custom styling.
  describe('Props', () => {
    it('should merge overlayClassName and className with default classes when overrides are provided', () => {
      // Arrange
      const overlayClassName = 'custom-overlay opacity-90'
      const className = 'custom-popup max-w-[640px]'

      // Act
      render(
        <DialogContent overlayClassName={overlayClassName} className={className}>
          <span>content</span>
        </DialogContent>,
      )

      const backdrop = screen.getByTestId('base-dialog-backdrop')
      const popup = screen.getByTestId('base-dialog-popup')

      // Assert
      expect(backdrop).toHaveClass('fixed', 'inset-0', 'custom-overlay', 'opacity-90')
      expect(popup).toHaveClass('fixed', 'left-1/2', 'custom-popup', 'max-w-[640px]')
      expect(popup).not.toHaveClass('max-w-[calc(100vw-2rem)]')
    })

    it('should render children inside popup when children are provided', () => {
      // Arrange
      const childText = 'child content'

      // Act
      render(
        <DialogContent>
          <div>{childText}</div>
        </DialogContent>,
      )

      const popup = screen.getByTestId('base-dialog-popup')

      // Assert
      expect(popup).toContainElement(screen.getByText(childText))
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
