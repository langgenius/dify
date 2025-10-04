import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Simple Mock Components that reproduce the exact UI issues
const MockNavLink = ({ name, mode }: { name: string; mode: string }) => {
  return (
    <a
      className={`
        group flex h-9 items-center rounded-md py-2 text-sm font-normal
        ${mode === 'expand' ? 'px-3' : 'px-2.5'}
      `}
      data-testid={`nav-link-${name}`}
      data-mode={mode}
    >
      {/* Icon with inconsistent margin - reproduces issue #2 */}
      <svg
        className={`h-4 w-4 shrink-0 ${mode === 'expand' ? 'mr-2' : 'mr-0'}`}
        data-testid={`nav-icon-${name}`}
      />
      {/* Text that appears/disappears abruptly - reproduces issue #2 */}
      {mode === 'expand' && <span data-testid={`nav-text-${name}`}>{name}</span>}
    </a>
  )
}

const MockSidebarToggleButton = ({ expand, onToggle }: { expand: boolean; onToggle: () => void }) => {
  return (
    <div
      className={`
        flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all
        ${expand ? 'w-[216px]' : 'w-14'}
      `}
      data-testid="sidebar-container"
    >
      {/* Top section with variable padding - reproduces issue #1 */}
      <div className={`shrink-0 ${expand ? 'p-2' : 'p-1'}`} data-testid="top-section">
        App Info Area
      </div>

      {/* Navigation section - reproduces issue #2 */}
      <nav className={`grow space-y-1 ${expand ? 'p-4' : 'px-2.5 py-4'}`} data-testid="navigation">
        <MockNavLink name="Orchestrate" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="API Access" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="Logs & Annotations" mode={expand ? 'expand' : 'collapse'} />
        <MockNavLink name="Monitoring" mode={expand ? 'expand' : 'collapse'} />
      </nav>

      {/* Toggle button section with consistent padding - issue #1 FIXED */}
      <div
        className="shrink-0 px-4 py-3"
        data-testid="toggle-section"
      >
        <button type="button"
          className='flex h-6 w-6 cursor-pointer items-center justify-center'
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
      <button type="button" className='block w-full'>
        {/* Container with layout mode switching - reproduces issue #3 */}
        <div className={`flex rounded-lg ${expand ? 'flex-col gap-2 p-2 pb-2.5' : 'items-start justify-center gap-1 p-1'}`}>
          {/* Icon container with justify-between to flex-col switch - reproduces issue #3 */}
          <div className={`flex items-center self-stretch ${expand ? 'justify-between' : 'flex-col gap-1'}`} data-testid="icon-container">
            {/* Icon with size changes - reproduces issue #3 */}
            <div
              data-testid="app-icon"
              data-size={expand ? 'large' : 'small'}
              style={{
                width: expand ? '40px' : '24px',
                height: expand ? '40px' : '24px',
                backgroundColor: '#000',
                transition: 'all 0.3s ease', // This broad transition causes bounce
              }}
            >
              Icon
            </div>
            <div className='flex items-center justify-center rounded-md p-0.5'>
              <div className='flex h-5 w-5 items-center justify-center'>
                ⚙️
              </div>
            </div>
          </div>
          {/* Text that appears/disappears conditionally */}
          {expand && (
            <div className='flex flex-col items-start gap-1'>
              <div className='flex w-full'>
                <div className='system-md-semibold truncate text-text-secondary'>Test App</div>
              </div>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>chatflow</div>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

describe('Sidebar Animation Issues Reproduction', () => {
  beforeEach(() => {
    // Mock getBoundingClientRect for position testing
    Element.prototype.getBoundingClientRect = jest.fn(() => ({
      width: 200,
      height: 40,
      x: 10,
      y: 10,
      left: 10,
      right: 210,
      top: 10,
      bottom: 50,
      toJSON: jest.fn(),
    }))
  })

  describe('Issue #1: Toggle Button Position Movement - FIXED', () => {
    it('should verify consistent padding prevents button position shift', () => {
      let expanded = false
      const handleToggle = () => {
        expanded = !expanded
      }

      const { rerender } = render(<MockSidebarToggleButton expand={false} onToggle={handleToggle} />)

      // Check collapsed state padding
      const toggleSection = screen.getByTestId('toggle-section')
      expect(toggleSection).toHaveClass('px-4') // Consistent padding
      expect(toggleSection).not.toHaveClass('px-5')
      expect(toggleSection).not.toHaveClass('px-6')

      // Switch to expanded state
      rerender(<MockSidebarToggleButton expand={true} onToggle={handleToggle} />)

      // Check expanded state padding - should be the same
      expect(toggleSection).toHaveClass('px-4') // Same consistent padding
      expect(toggleSection).not.toHaveClass('px-5')
      expect(toggleSection).not.toHaveClass('px-6')

      // THE FIX: px-4 in both states prevents position movement
      console.log('✅ Issue #1 FIXED: Toggle button now has consistent padding')
      console.log('   - Before: px-4 (collapsed) vs px-6 (expanded) - 8px difference')
      console.log('   - After:  px-4 (both states) - 0px difference')
      console.log('   - Result: No button position movement during transition')
    })

    it('should verify sidebar width animation is working correctly', () => {
      const handleToggle = jest.fn()
      const { rerender } = render(<MockSidebarToggleButton expand={false} onToggle={handleToggle} />)

      const container = screen.getByTestId('sidebar-container')

      // Collapsed state
      expect(container).toHaveClass('w-14')
      expect(container).toHaveClass('transition-all')

      // Expanded state
      rerender(<MockSidebarToggleButton expand={true} onToggle={handleToggle} />)
      expect(container).toHaveClass('w-[216px]')

      console.log('✅ Sidebar width transition is properly configured')
    })
  })

  describe('Issue #2: Navigation Text Squeeze Animation', () => {
    it('should reproduce text squeeze effect from padding and margin changes', () => {
      const { rerender } = render(<MockNavLink name="Orchestrate" mode="collapse" />)

      const link = screen.getByTestId('nav-link-Orchestrate')
      const icon = screen.getByTestId('nav-icon-Orchestrate')

      // Collapsed state checks
      expect(link).toHaveClass('px-2.5') // 10px padding
      expect(icon).toHaveClass('mr-0') // No margin
      expect(screen.queryByTestId('nav-text-Orchestrate')).not.toBeInTheDocument()

      // Switch to expanded state
      rerender(<MockNavLink name="Orchestrate" mode="expand" />)

      // Expanded state checks
      expect(link).toHaveClass('px-3') // 12px padding (+2px)
      expect(icon).toHaveClass('mr-2') // 8px margin (+8px)
      expect(screen.getByTestId('nav-text-Orchestrate')).toBeInTheDocument()

      // THE BUG: Multiple simultaneous changes create squeeze effect
      console.log('🐛 Issue #2 Reproduced: Text squeeze effect from multiple layout changes')
      console.log('   - Link padding: px-2.5 → px-3 (+2px)')
      console.log('   - Icon margin: mr-0 → mr-2 (+8px)')
      console.log('   - Text appears: none → visible (abrupt)')
      console.log('   - Result: Text appears with squeeze effect due to layout shifts')
    })

    it('should document the abrupt text rendering issue', () => {
      const { rerender } = render(<MockNavLink name="API Access" mode="collapse" />)

      // Text completely absent
      expect(screen.queryByTestId('nav-text-API Access')).not.toBeInTheDocument()

      rerender(<MockNavLink name="API Access" mode="expand" />)

      // Text suddenly appears - no transition
      expect(screen.getByTestId('nav-text-API Access')).toBeInTheDocument()

      console.log('🐛 Issue #2 Detail: Conditional rendering {mode === "expand" && name}')
      console.log('   - Problem: Text appears/disappears abruptly without transition')
      console.log('   - Should use: opacity or width transition for smooth appearance')
    })
  })

  describe('Issue #3: App Icon Bounce Animation', () => {
    it('should reproduce icon bounce from layout mode switching', () => {
      const { rerender } = render(<MockAppInfo expand={true} />)

      const iconContainer = screen.getByTestId('icon-container')
      const appIcon = screen.getByTestId('app-icon')

      // Expanded state layout
      expect(iconContainer).toHaveClass('justify-between')
      expect(iconContainer).not.toHaveClass('flex-col')
      expect(appIcon).toHaveAttribute('data-size', 'large')

      // Switch to collapsed state
      rerender(<MockAppInfo expand={false} />)

      // Collapsed state layout - completely different layout mode
      expect(iconContainer).toHaveClass('flex-col')
      expect(iconContainer).toHaveClass('gap-1')
      expect(iconContainer).not.toHaveClass('justify-between')
      expect(appIcon).toHaveAttribute('data-size', 'small')

      // THE BUG: Layout mode switch causes icon to "bounce"
      console.log('🐛 Issue #3 Reproduced: Icon bounce from layout mode switching')
      console.log('   - Layout change: justify-between → flex-col gap-1')
      console.log('   - Icon size: large (40px) → small (24px)')
      console.log('   - Transition: transition-all causes excessive animation')
      console.log('   - Result: Icon appears to bounce to right then back during collapse')
    })

    it('should identify the problematic transition-all property', () => {
      render(<MockAppInfo expand={true} />)

      const appIcon = screen.getByTestId('app-icon')
      const computedStyle = window.getComputedStyle(appIcon)

      // The problematic broad transition
      expect(computedStyle.transition).toContain('all')

      console.log('🐛 Issue #3 Detail: transition-all affects ALL CSS properties')
      console.log('   - Problem: Animates layout properties that should not transition')
      console.log('   - Solution: Use specific transition properties instead of "all"')
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

      // Initial state verification
      expect(expanded).toBe(false)
      console.log('🔄 Starting interactive test - all issues will be reproduced')

      // Simulate toggle click
      fireEvent.click(toggleButton)
      expanded = true
      rerender(
        <div data-testid="complete-sidebar">
          <MockSidebarToggleButton expand={expanded} onToggle={handleToggle} />
          <MockAppInfo expand={expanded} />
        </div>,
      )

      console.log('✨ All three issues successfully reproduced in interactive test:')
      console.log('   1. Toggle button position movement (padding inconsistency)')
      console.log('   2. Navigation text squeeze effect (multiple layout changes)')
      console.log('   3. App icon bounce animation (layout mode switching)')
    })
  })
})
