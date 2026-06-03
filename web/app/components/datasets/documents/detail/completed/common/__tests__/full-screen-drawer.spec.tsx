import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentDetailDrawer } from '../full-screen-drawer'

// Mock the Drawer component since it has high complexity
vi.mock('../drawer', () => ({
  CompletedDrawer: ({ children, open, panelClassName, panelContentClassName, modal }: { children: ReactNode, open: boolean, panelClassName: string, panelContentClassName: string, modal: boolean }) => {
    if (!open)
      return null
    return (
      <div
        data-testid="drawer-mock"
        data-panel-class={panelClassName}
        data-panel-content-class={panelContentClassName}
        data-modal={modal}
      >
        {children}
      </div>
    )
  },
}))

describe('DocumentDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing when open', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      expect(screen.getByTestId('drawer-mock')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(
        <DocumentDetailDrawer open={false} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      expect(screen.queryByTestId('drawer-mock')).not.toBeInTheDocument()
    })

    it('should render children content', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Test Content</div>
        </DocumentDetailDrawer>,
      )

      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass fullScreen=true to Drawer with full width class', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={true}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-panel-class')).toContain('w-full')
      expect(drawer.getAttribute('data-panel-class')).toContain('data-[swipe-direction=right]:w-full')
      expect(drawer.getAttribute('data-panel-class')).toContain('data-[swipe-direction=left]:w-full')
    })

    it('should pass fullScreen=false to Drawer with fixed width class', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-panel-class')).toContain('w-[568px]')
      expect(drawer.getAttribute('data-panel-class')).toContain('data-[swipe-direction=right]:w-[568px]')
      expect(drawer.getAttribute('data-panel-class')).toContain('data-[swipe-direction=left]:w-[568px]')
    })

    it('should render as non-modal by default', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-modal')).toBe('false')
    })

    it('should pass modal when specified', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false} modal>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      expect(drawer.getAttribute('data-modal')).toBe('true')
    })
  })

  // Styling tests
  describe('Styling', () => {
    it('should apply panel content classes for non-fullScreen mode', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      const contentClass = drawer.getAttribute('data-panel-content-class')
      expect(contentClass).toContain('bg-components-panel-bg')
      expect(contentClass).toContain('rounded-xl')
    })

    it('should apply panel content classes without border for fullScreen mode', () => {
      render(
        <DocumentDetailDrawer open={true} fullScreen={true}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      const drawer = screen.getByTestId('drawer-mock')
      const contentClass = drawer.getAttribute('data-panel-content-class')
      expect(contentClass).toContain('bg-components-panel-bg')
      expect(contentClass).not.toContain('rounded-xl')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined onClose gracefully', () => {
      // Arrange & Act & Assert - should not throw
      expect(() => {
        render(
          <DocumentDetailDrawer open={true} fullScreen={false}>
            <div>Content</div>
          </DocumentDetailDrawer>,
        )
      }).not.toThrow()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      rerender(
        <DocumentDetailDrawer open={true} fullScreen={true}>
          <div>Updated Content</div>
        </DocumentDetailDrawer>,
      )

      expect(screen.getByText('Updated Content')).toBeInTheDocument()
    })

    it('should handle toggle between open and closed states', () => {
      const { rerender } = render(
        <DocumentDetailDrawer open={true} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )
      expect(screen.getByTestId('drawer-mock')).toBeInTheDocument()

      rerender(
        <DocumentDetailDrawer open={false} fullScreen={false}>
          <div>Content</div>
        </DocumentDetailDrawer>,
      )

      expect(screen.queryByTestId('drawer-mock')).not.toBeInTheDocument()
    })
  })
})
