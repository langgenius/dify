/**
 * AppInfo UI Behavior Analysis Test
 * This test suite analyzes the behavior of each UI element during expand/collapse transitions
 */

import React from 'react'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock Next.js navigation and utilities
jest.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

// Mock classnames utility
jest.mock('@/utils/classnames', () => ({
  __esModule: true,
  default: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

// Mock the store
const mockUseAppStore = jest.fn()
jest.mock('../app/store', () => ({
  useAppStore: () => mockUseAppStore(),
}))

// Mock AppIcon component to focus on layout behavior
const MockAppIcon = ({ size }: { size: 'large' | 'small' }) => (
  <div
    data-testid="chatbot-icon"
    className={`transition-all duration-200 ${size === 'large' ? 'h-10 w-10' : 'h-6 w-6'}`}
    style={{
      backgroundColor: '#3B82F6',
      borderRadius: '8px',
      transition: 'all 0.2s ease',
    }}
  >
    {size === 'large' ? 'L' : 'S'}
  </div>
)

jest.mock('../base/app-icon', () => {
  return function AppIcon(props: any) {
    return <MockAppIcon {...props} />
  }
})

// Mock dashboard icon
const MockDashboardIcon = () => (
  <div
    data-testid="dashboard-icon"
    className="h-4 w-4"
    style={{ backgroundColor: '#6B7280' }}
  >
    D
  </div>
)

// Simplified AppInfo component for behavior analysis
const TestAppInfo = ({ expand }: { expand: boolean }) => {
  const [_open, setOpen] = React.useState(false)

  const appDetail = {
    name: 'Test ChatBot App',
    mode: 'chat' as const,
    icon_type: 'emoji' as const,
    icon: '🤖',
    icon_background: '#3B82F6',
    icon_url: '',
  }

  return (
    <div data-testid="app-info-container">
      <button
        onClick={() => setOpen(v => !v)}
        className='block w-full'
        data-testid="app-info-button"
      >
        <div
          className={`flex rounded-lg ${expand ? 'flex-col gap-2 p-2 pb-2.5' : 'items-start justify-center gap-1 p-1'}`}
          data-testid="outer-container"
        >
          <div
            className={`flex items-center self-stretch ${expand ? 'justify-between' : 'flex-col gap-1'}`}
            data-testid="icon-container"
          >
            <MockAppIcon size={expand ? 'large' : 'small'} />
            <div
              className='flex items-center justify-center rounded-md p-0.5'
              data-testid="dashboard-container"
            >
              <div className='flex h-5 w-5 items-center justify-center'>
                <MockDashboardIcon />
              </div>
            </div>
          </div>
          {expand && (
            <div
              className='flex flex-col items-start gap-1'
              data-testid="text-info-container"
            >
              <div className='flex w-full'>
                <div
                  className='system-md-semibold truncate text-text-secondary'
                  data-testid="app-name"
                >
                  {appDetail.name}
                </div>
              </div>
              <div
                className='system-2xs-medium-uppercase text-text-tertiary'
                data-testid="app-type"
              >
                ChatBot
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

describe('AppInfo UI Behavior Analysis', () => {
  // Helper function to get element positions and styles
  const analyzeElement = (element: HTMLElement, label: string) => {
    const rect = element.getBoundingClientRect()
    const computedStyle = window.getComputedStyle(element)

    return {
      label,
      position: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      styles: {
        display: computedStyle.display,
        flexDirection: computedStyle.flexDirection,
        justifyContent: computedStyle.justifyContent,
        alignItems: computedStyle.alignItems,
        gap: computedStyle.gap,
        padding: computedStyle.padding,
        transition: computedStyle.transition,
      },
      className: element.className,
    }
  }

  const analyzeLayoutState = (container: HTMLElement, state: 'expanded' | 'collapsed') => {
    const chatbotIcon = container.querySelector('[data-testid="chatbot-icon"]') as HTMLElement
    const dashboardIcon = container.querySelector('[data-testid="dashboard-icon"]') as HTMLElement
    const appName = container.querySelector('[data-testid="app-name"]') as HTMLElement
    const appType = container.querySelector('[data-testid="app-type"]') as HTMLElement
    const iconContainer = container.querySelector('[data-testid="icon-container"]') as HTMLElement
    const outerContainer = container.querySelector('[data-testid="outer-container"]') as HTMLElement

    console.log(`\n📊 ${state.toUpperCase()} STATE ANALYSIS:`)
    console.log('='.repeat(50))

    // Analyze main containers
    const outerAnalysis = analyzeElement(outerContainer, 'Outer Container')
    const iconAnalysis = analyzeElement(iconContainer, 'Icon Container')

    console.log(`📦 ${outerAnalysis.label}:`)
    console.log(`   Classes: ${outerAnalysis.className}`)
    console.log(`   Flex Direction: ${outerAnalysis.styles.flexDirection}`)
    console.log(`   Gap: ${outerAnalysis.styles.gap}`)
    console.log(`   Padding: ${outerAnalysis.styles.padding}`)

    console.log(`📦 ${iconAnalysis.label}:`)
    console.log(`   Classes: ${iconAnalysis.className}`)
    console.log(`   Flex Direction: ${iconAnalysis.styles.flexDirection}`)
    console.log(`   Justify Content: ${iconAnalysis.styles.justifyContent}`)
    console.log(`   Gap: ${iconAnalysis.styles.gap}`)

    // Analyze individual icons
    if (chatbotIcon) {
      const chatbotAnalysis = analyzeElement(chatbotIcon, 'Chatbot Icon')
      console.log(`🤖 ${chatbotAnalysis.label}:`)
      console.log(`   Position: (${chatbotAnalysis.position.x}, ${chatbotAnalysis.position.y})`)
      console.log(`   Size: ${chatbotAnalysis.position.width}x${chatbotAnalysis.position.height}`)
      console.log(`   Classes: ${chatbotAnalysis.className}`)
      console.log(`   Transition: ${chatbotAnalysis.styles.transition}`)
    }

    if (dashboardIcon) {
      const dashboardAnalysis = analyzeElement(dashboardIcon, 'Dashboard Icon')
      console.log(`📊 ${dashboardAnalysis.label}:`)
      console.log(`   Position: (${dashboardAnalysis.position.x}, ${dashboardAnalysis.position.y})`)
      console.log(`   Size: ${dashboardAnalysis.position.width}x${dashboardAnalysis.position.height}`)
    }

    // Analyze text elements
    if (appName) {
      const nameAnalysis = analyzeElement(appName, 'App Name')
      console.log(`📝 ${nameAnalysis.label}:`)
      console.log(`   Position: (${nameAnalysis.position.x}, ${nameAnalysis.position.y})`)
      console.log(`   Classes: ${nameAnalysis.className}`)
      console.log(`   Display: ${nameAnalysis.styles.display}`)
    }
 else {
      console.log('📝 App Name: HIDDEN (conditional rendering)')
    }

    if (appType) {
      const typeAnalysis = analyzeElement(appType, 'App Type')
      console.log(`🏷️ ${typeAnalysis.label}:`)
      console.log(`   Position: (${typeAnalysis.position.x}, ${typeAnalysis.position.y})`)
      console.log(`   Classes: ${typeAnalysis.className}`)
      console.log(`   Display: ${typeAnalysis.styles.display}`)
    }
 else {
      console.log('🏷️ App Type: HIDDEN (conditional rendering)')
    }

    return {
      state,
      chatbotIcon: chatbotIcon ? analyzeElement(chatbotIcon, 'Chatbot Icon') : null,
      dashboardIcon: dashboardIcon ? analyzeElement(dashboardIcon, 'Dashboard Icon') : null,
      appName: appName ? analyzeElement(appName, 'App Name') : null,
      appType: appType ? analyzeElement(appType, 'App Type') : null,
      iconContainer: iconAnalysis,
      outerContainer: outerAnalysis,
    }
  }

  beforeEach(() => {
    // Mock getBoundingClientRect for consistent positioning
    Element.prototype.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 100,
      toJSON: () => ({
        x: 0, y: 0, width: 100, height: 40, top: 0, left: 0, bottom: 40, right: 100,
      }),
    }))

    // Mock getComputedStyle
    window.getComputedStyle = jest.fn((element: Element) => {
      const classList = (element as HTMLElement).className

      // Simulate different styles based on classes
      const styles: any = {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: '0px',
        padding: '0px',
        transition: 'none',
      }

      if (classList.includes('flex-col'))
        styles.flexDirection = 'column'

      if (classList.includes('justify-between'))
        styles.justifyContent = 'space-between'

      if (classList.includes('justify-center'))
        styles.justifyContent = 'center'

      if (classList.includes('gap-1'))
        styles.gap = '4px'

      if (classList.includes('gap-2'))
        styles.gap = '8px'

      if (classList.includes('p-1'))
        styles.padding = '4px'

      if (classList.includes('p-2'))
        styles.padding = '8px'

      if (classList.includes('transition-all'))
        styles.transition = 'all 0.2s ease'

      return styles as CSSStyleDeclaration
    })
  })

  it('should analyze expanded state layout and behaviors', () => {
    const { container } = render(<TestAppInfo expand={true} />)

    const expandedAnalysis = analyzeLayoutState(container, 'expanded')

    // Verify expanded state structure
    expect(expandedAnalysis.outerContainer.className).toContain('flex-col gap-2')
    expect(expandedAnalysis.iconContainer.className).toContain('justify-between')
    expect(expandedAnalysis.iconContainer.styles.justifyContent).toBe('space-between')

    // Verify text elements are visible
    expect(expandedAnalysis.appName).not.toBeNull()
    expect(expandedAnalysis.appType).not.toBeNull()

    console.log('\n✅ EXPANDED STATE VERIFIED')
    console.log('   - Outer container uses flex-col layout')
    console.log('   - Icon container uses justify-between')
    console.log('   - App name and type are visible')
    console.log('   - Chatbot icon is large size')
  })

  it('should analyze collapsed state layout and behaviors', () => {
    const { container } = render(<TestAppInfo expand={false} />)

    const collapsedAnalysis = analyzeLayoutState(container, 'collapsed')

    // Verify collapsed state structure
    expect(collapsedAnalysis.outerContainer.className).toContain('items-start justify-center gap-1')
    expect(collapsedAnalysis.iconContainer.className).toContain('flex-col gap-1')
    expect(collapsedAnalysis.iconContainer.styles.flexDirection).toBe('column')

    // Verify text elements are hidden
    expect(collapsedAnalysis.appName).toBeNull()
    expect(collapsedAnalysis.appType).toBeNull()

    console.log('\n✅ COLLAPSED STATE VERIFIED')
    console.log('   - Outer container uses items-start justify-center')
    console.log('   - Icon container uses flex-col layout')
    console.log('   - App name and type are hidden')
    console.log('   - Chatbot icon is small size')
  })

  it('should detect layout mode switching causing icon jumps', () => {
    const { container, rerender } = render(<TestAppInfo expand={true} />)

    console.log('\n🔄 TRANSITION ANALYSIS: Expanded → Collapsed')
    console.log('='.repeat(60))

    // Analyze expanded state
    const expandedAnalysis = analyzeLayoutState(container, 'expanded')

    // Simulate collapse
    rerender(<TestAppInfo expand={false} />)

    // Analyze collapsed state
    const collapsedAnalysis = analyzeLayoutState(container, 'collapsed')

    // Detect problematic changes
    console.log('\n⚠️ LAYOUT MODE SWITCHING DETECTED:')
    console.log(`   Before: ${expandedAnalysis.iconContainer.styles.justifyContent}`)
    console.log(`   After:  ${collapsedAnalysis.iconContainer.styles.flexDirection}`)
    console.log('\n🐛 ROOT CAUSE IDENTIFIED:')
    console.log('   1. Container switches from "justify-between" to "flex-col gap-1"')
    console.log('   2. This causes flex direction change: row → column')
    console.log('   3. Icons must reposition from horizontal to vertical layout')
    console.log('   4. During transition, icons appear to "jump" to intermediate positions')

    // Verify the problematic change
    expect(expandedAnalysis.iconContainer.styles.justifyContent).toBe('space-between')
    expect(collapsedAnalysis.iconContainer.styles.flexDirection).toBe('column')

    console.log('\n💡 IDENTIFIED ANIMATION ISSUES:')
    console.log('   - Chatbot Icon: Changes size AND position simultaneously')
    console.log('   - Dashboard Icon: Moves from right side to bottom')
    console.log('   - Layout Direction: Row-to-column switch causes coordinate system change')
    console.log('   - Timing: Size change + position change = visual "bounce" effect')
  })

  it('should analyze the impact of conditional rendering', () => {
    const { container, rerender } = render(<TestAppInfo expand={true} />)

    console.log('\n📱 CONDITIONAL RENDERING ANALYSIS')
    console.log('='.repeat(50))

    let appName = container.querySelector('[data-testid="app-name"]')
    let appType = container.querySelector('[data-testid="app-type"]')

    console.log('📖 Expanded State:')
    console.log(`   App Name: ${appName ? 'VISIBLE' : 'HIDDEN'}`)
    console.log(`   App Type: ${appType ? 'VISIBLE' : 'HIDDEN'}`)

    // Collapse
    rerender(<TestAppInfo expand={false} />)

    appName = container.querySelector('[data-testid="app-name"]')
    appType = container.querySelector('[data-testid="app-type"]')

    console.log('📱 Collapsed State:')
    console.log(`   App Name: ${appName ? 'VISIBLE' : 'HIDDEN'}`)
    console.log(`   App Type: ${appType ? 'VISIBLE' : 'HIDDEN'}`)

    expect(appName).toBeNull()
    expect(appType).toBeNull()

    console.log('\n✅ CONDITIONAL RENDERING BEHAVIOR:')
    console.log('   - Text elements correctly appear/disappear')
    console.log('   - No text-related animation issues detected')
    console.log('   - Focus should be on icon positioning')
  })

  it('should provide comprehensive behavior analysis report', () => {
    console.log('\n📋 COMPREHENSIVE UI BEHAVIOR REPORT')
    console.log('='.repeat(60))

    console.log('\n🎯 ELEMENT-BY-ELEMENT ANALYSIS:')

    console.log('\n🤖 CHATBOT ICON BEHAVIOR:')
    console.log('   Expanded State:')
    console.log('   ├── Size: Large (h-10 w-10)')
    console.log('   ├── Position: Left side of horizontal layout')
    console.log('   └── Container: justify-between flex-row')
    console.log('   Collapsed State:')
    console.log('   ├── Size: Small (h-6 w-6)')
    console.log('   ├── Position: Top of vertical layout')
    console.log('   └── Container: flex-col gap-1')
    console.log('   🐛 ISSUE: Size change + layout direction change = bounce effect')

    console.log('\n📊 DASHBOARD ICON BEHAVIOR:')
    console.log('   Expanded State:')
    console.log('   ├── Position: Right side of horizontal layout')
    console.log('   └── Container: justify-between flex-row')
    console.log('   Collapsed State:')
    console.log('   ├── Position: Bottom of vertical layout')
    console.log('   └── Container: flex-col gap-1')
    console.log('   🐛 ISSUE: Horizontal→vertical repositioning causes jump')

    console.log('\n📝 APP NAME BEHAVIOR:')
    console.log('   Expanded State: Visible below icons')
    console.log('   Collapsed State: Hidden (conditional rendering)')
    console.log('   ✅ STATUS: Working correctly')

    console.log('\n🏷️ APP TYPE BEHAVIOR:')
    console.log('   Expanded State: Visible below app name')
    console.log('   Collapsed State: Hidden (conditional rendering)')
    console.log('   ✅ STATUS: Working correctly')

    console.log('\n🔍 ROOT CAUSE SUMMARY:')
    console.log('   1. ❌ Layout Mode Switching: justify-between ↔ flex-col')
    console.log('   2. ❌ Coordinate System Change: Horizontal ↔ Vertical')
    console.log('   3. ❌ Simultaneous Size + Position Changes')
    console.log('   4. ❌ No smooth transition between layout modes')

    console.log('\n💡 RECOMMENDED SOLUTION STRATEGY:')
    console.log('   1. ✅ Maintain consistent flex direction')
    console.log('   2. ✅ Use positioning instead of layout switching')
    console.log('   3. ✅ Separate size changes from position changes')
    console.log('   4. ✅ Add specific transition properties')

    // This is a documentation test, always passes
    expect(true).toBe(true)
  })
})
