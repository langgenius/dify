import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

const MockNavLink = ({ name, mode }: { name: string, mode: string }) => {
  return (
    <a
      className={`
        group flex h-9 items-center rounded-md py-2 text-sm font-normal
        ${mode === 'expand' ? 'px-3' : 'px-2.5'}
      `}
      data-testid={`nav-link-${name}`}
      data-mode={mode}
    >
      <svg
        className={`h-4 w-4 shrink-0 ${mode === 'expand' ? 'mr-2' : 'mr-0'}`}
        data-testid={`nav-icon-${name}`}
      />
      {mode === 'expand' && <span data-testid={`nav-text-${name}`}>{name}</span>}
    </a>
  )
}

const MockSidebarToggleButton = ({ expand, onToggle }: { expand: boolean, onToggle: () => void }) => {
  return (
    <div
      className={`
        flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all
        ${expand ? 'w-[216px]' : 'w-14'}
      `}
      data-testid="sidebar-container"
    >
      <div className={`shrink-0 ${expand ? 'p-2' : 'p-1'}`} data-testid="top-section">
        App Info Area
      </div>

      <nav className={`grow space-y-1 ${expand ? 'p-4' : 'px-2.5 py-4'}`} data-testid="navigation">
        <MockNavLink name="Orchestrate" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="API Access" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="Logs & Annotations" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="Monitoring" mode={expand ? 'expand' : 'collapse'} />
      </nav>

      <div
        className="shrink-0 px-4 py-3"
        data-testid="toggle-section"
      >
        <button
          type="button"
          className="flex h-6 w-6 cursor-pointer items-center justify-center"
          onClick={onToggle}
          data-testid="toggle-button"
        >
          {expand ? '→' : '←'}
        </button>
      </div>
    </div>
  )
}

const MockAppInfo = ({ expand }: { expand: boolean }) => {
  return (
    <div data-testid="app-info" data-expand={expand}>
      <button type="button" className="block w-full">
        <div className={`flex rounded-lg ${expand ? 'flex-col gap-2 p-2 pb-2.5' : 'items-start justify-center gap-1 p-1'}`}>
          <div className={`flex items-center self-stretch ${expand ? 'justify-between' : 'flex-col gap-1'}`} data-testid="icon-container">
            <div
              data-testid="app-icon"
              data-size={expand ? 'large' : 'small'}
              style={{
                width: expand ? '40px' : '24px',
                height: expand ? '40px' : '24px',
                backgroundColor: '#000',
                transition: 'all 0.3s ease',
              }}
            >
              Icon
            </div>
            <div className="flex items-center justify-center rounded-md p-0.5">
              <div className="flex h-5 w-5 items-center justify-center">
                ⚙️
              </div>
            </div>
          </div>
          {expand && (
            <div className="flex flex-col items-start gap-1">
              <div className="flex w-full">
                <div className="system-md-semibold truncate text-text-secondary">Test App</div>
              </div>
              <div className="system-2xs-medium-uppercase text-text-tertiary">chatflow</div>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

describe('Sidebar Animation Issues Reproduction', () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 200,
      height: 40,
      x: 10,
      y: 10,
      left: 10,
      right: 210,
      top: 10,
      bottom: 50,
      toJSON: vi.fn(),
    }))
  })

  describe('Issue #1: Toggle Button Position Movement - FIXED', () => {
    it('should verify consistent padding prevents button position shift', () => {
      let expanded = false
      const handleToggle = () => {
        expanded = !expanded
      }

      const { rerender } = render(<MockSidebarToggleButton expand={false} onToggle={handleToggle} />)

      const toggleSection = screen.getByTestId('toggle-section')
      expect(toggleSection).toHaveClass('px-4')
      expect(toggleSection).not.toHaveClass('px-5')
      expect(toggleSection).not.toHaveClass('px-6')

      rerender(<MockSidebarToggleButton expand={true} onToggle={handleToggle} />)

      expect(toggleSection).toHaveClass('px-4')
      expect(toggleSection).not.toHaveClass('px-5')
      expect(toggleSection).not.toHaveClass('px-6')
    })

    it('should verify sidebar width animation is working correctly', () => {
      const handleToggle = vi.fn()
      const { rerender } = render(<MockSidebarToggleButton expand={false} onToggle={handleToggle} />)

      const container = screen.getByTestId('sidebar-container')

      expect(container).toHaveClass('w-14')
      expect(container).toHaveClass('transition-all')

      rerender(<MockSidebarToggleButton expand={true} onToggle={handleToggle} />)
      expect(container).toHaveClass('w-[216px]')
    })
  })

  describe('Issue #2: Navigation Text Squeeze Animation', () => {
    it('should reproduce text squeeze effect from padding and margin changes', () => {
      const { rerender } = render(<MockNavLink name="Orchestrate" mode="collapse" />)

      const link = screen.getByTestId('nav-link-Orchestrate')
      const icon = screen.getByTestId('nav-icon-Orchestrate')

      expect(link).toHaveClass('px-2.5')
      expect(icon).toHaveClass('mr-0')
      expect(screen.queryByTestId('nav-text-Orchestrate')).not.toBeInTheDocument()

      rerender(<MockNavLink name="Orchestrate" mode="expand" />)

      expect(link).toHaveClass('px-3')
      expect(icon).toHaveClass('mr-2')
      expect(screen.getByTestId('nav-text-Orchestrate')).toBeInTheDocument()
    })

    it('should document the abrupt text rendering issue', () => {
      const { rerender } = render(<MockNavLink name="API Access" mode="collapse" />)

      expect(screen.queryByTestId('nav-text-API Access')).not.toBeInTheDocument()

      rerender(<MockNavLink name="API Access" mode="expand" />)

      expect(screen.getByTestId('nav-text-API Access')).toBeInTheDocument()
    })
  })

  describe('Issue #3: App Icon Bounce Animation', () => {
    it('should reproduce icon bounce from layout mode switching', () => {
      const { rerender } = render(<MockAppInfo expand={true} />)

      const iconContainer = screen.getByTestId('icon-container')
      const appIcon = screen.getByTestId('app-icon')

      expect(iconContainer).toHaveClass('justify-between')
      expect(iconContainer).not.toHaveClass('flex-col')
      expect(appIcon).toHaveAttribute('data-size', 'large')

      rerender(<MockAppInfo expand={false} />)

      expect(iconContainer).toHaveClass('flex-col')
      expect(iconContainer).toHaveClass('gap-1')
      expect(iconContainer).not.toHaveClass('justify-between')
      expect(appIcon).toHaveAttribute('data-size', 'small')
    })

    it('should identify the problematic transition-all property', () => {
      render(<MockAppInfo expand={true} />)

      const appIcon = screen.getByTestId('app-icon')
      const computedStyle = window.getComputedStyle(appIcon)

      expect(computedStyle.transition).toContain('all')
    })
  })

  describe('Interactive Toggle Test', () => {
    it('should demonstrate all issues in a single interactive test', () => {
      let expanded = false
      const handleToggle = () => {
        expanded = !expanded
      }

      const { rerender } = render(
        <div data-testid="complete-sidebar">
          <MockSidebarToggleButton expand={expanded} onToggle={handleToggle} />
          <MockAppInfo expand={expanded} />
        </div>,
      )

      const toggleButton = screen.getByTestId('toggle-button')

      expect(expanded).toBe(false)

      fireEvent.click(toggleButton)
      expanded = true
      rerender(
        <div data-testid="complete-sidebar">
          <MockSidebarToggleButton expand={expanded} onToggle={handleToggle} />
          <MockAppInfo expand={expanded} />
        </div>,
      )

      expect(screen.getByTestId('sidebar-container')).toHaveClass('w-[216px]')
      expect(screen.getByTestId('app-icon')).toHaveAttribute('data-size', 'large')
    })
  })
})
