import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FullScreenDrawer from './full-screen-drawer'

// Mock the Drawer component since it has high complexity
vi.mock('./drawer', () => ({
  default: ({ children, open, panelClassName, panelContentClassName, showOverlay, needCheckChunks, modal }: { children: ReactNode, open: boolean, panelClassName: string, panelContentClassName: string, showOverlay: boolean, needCheckChunks: boolean, modal: boolean }) => {
    if (!open)
      return null
    return (
      <div
        data-testid="drawer-mock"
        data-panel-class={panelClassName}
        data-panel-content-class={panelContentClassName}
        data-show-overlay={showOverlay}
        data-need-check-chunks={needCheckChunks}
        data-modal={modal}
      >
        {children}
      </div>
    )
  },
}))

describe('FullScreenDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing when open', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      expect(screen.getByTestId('drawer-mock')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={false} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      expect(screen.queryByTestId('drawer-mock')).not.toBeInTheDocument()
    })

    it('should render children content', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Test Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })
  })

  // Props tests
  describe('Props', () => {
    it('should pass fullScreen=true to Drawer with full width class', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={true}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-panel-class')).toContain('w-full')
    })

    it('should pass fullScreen=false to Drawer with fixed width class', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-panel-class')).toContain('w-[568px]')
    })

    it('should pass showOverlay prop with default true', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-show-overlay')).toBe('true')
    })

    it('should pass showOverlay=false when specified', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false} showOverlay={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-show-overlay')).toBe('false')
    })

    it('should pass needCheckChunks prop with default false', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-need-check-chunks')).toBe('false')
    })

    it('should pass needCheckChunks=true when specified', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false} needCheckChunks={true}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-need-check-chunks')).toBe('true')
    })

    it('should pass modal prop with default false', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-modal')).toBe('false')
    })

    it('should pass modal=true when specified', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false} modal={true}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-modal')).toBe('true')
    })
  })

  // Styling tests
  describe('Styling', () => {
    it('should apply panel content classes for non-fullScreen mode', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      const contentClass = drawer.getAttribute('data-panel-content-class')
      expect(contentClass).toContain('bg-components-panel-bg')
      expect(contentClass).toContain('rounded-xl')
    })

    it('should apply panel content classes without border for fullScreen mode', () => {
      // Arrange & Act
      render(
        <FullScreenDrawer isOpen={true} fullScreen={true}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      const drawer = screen.getByTestId('drawer-mock')
      const contentClass = drawer.getAttribute('data-panel-content-class')
      expect(contentClass).toContain('bg-components-panel-bg')
      expect(contentClass).not.toContain('rounded-xl')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined onClose gracefully', () => {
      // Arrange & Act & Assert - should not throw
      expect(() => {
        render(
          <FullScreenDrawer isOpen={true} fullScreen={false}>
            <div>Content</div>
          </FullScreenDrawer>,
        )
      }).not.toThrow()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Act
      rerender(
        <FullScreenDrawer isOpen={true} fullScreen={true}>
          <div>Updated Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      expect(screen.getByText('Updated Content')).toBeInTheDocument()
    })

    it('should handle toggle between open and closed states', () => {
      // Arrange
      const { rerender } = render(
        <FullScreenDrawer isOpen={true} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )
      expect(screen.getByTestId('drawer-mock')).toBeInTheDocument()

      // Act
      rerender(
        <FullScreenDrawer isOpen={false} fullScreen={false}>
          <div>Content</div>
        </FullScreenDrawer>,
      )

      // Assert
      expect(screen.queryByTestId('drawer-mock')).not.toBeInTheDocument()
    })
  })
})
