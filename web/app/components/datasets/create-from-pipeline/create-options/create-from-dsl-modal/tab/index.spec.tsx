import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import Tab from './index'

// ============================================================================
// Tab Component Tests
// ============================================================================

describe('Tab', () => {
  const defaultProps = {
    currentTab: CreateFromDSLModalTab.FROM_FILE,
    setCurrentTab: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Tab {...defaultProps} />)
      expect(screen.getByText(/importFromDSLFile/i)).toBeInTheDocument()
    })

    it('should render file tab', () => {
      render(<Tab {...defaultProps} />)
      expect(screen.getByText(/importFromDSLFile/i)).toBeInTheDocument()
    })

    it('should render URL tab', () => {
      render(<Tab {...defaultProps} />)
      expect(screen.getByText(/importFromDSLUrl/i)).toBeInTheDocument()
    })

    it('should render both tabs', () => {
      render(<Tab {...defaultProps} />)
      const tabs = screen.getAllByText(/importFromDSL/i)
      expect(tabs.length).toBe(2)
    })
  })

  // --------------------------------------------------------------------------
  // Active State Tests
  // --------------------------------------------------------------------------
  describe('Active State', () => {
    it('should mark file tab as active when currentTab is FROM_FILE', () => {
      const { container } = render(
        <Tab {...defaultProps} currentTab={CreateFromDSLModalTab.FROM_FILE} />,
      )
      const activeIndicators = container.querySelectorAll('[class*="bg-util-colors-blue-brand"]')
      expect(activeIndicators.length).toBe(1)
    })

    it('should mark URL tab as active when currentTab is FROM_URL', () => {
      const { container } = render(
        <Tab {...defaultProps} currentTab={CreateFromDSLModalTab.FROM_URL} />,
      )
      const activeIndicators = container.querySelectorAll('[class*="bg-util-colors-blue-brand"]')
      expect(activeIndicators.length).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call setCurrentTab with FROM_FILE when file tab is clicked', () => {
      render(<Tab {...defaultProps} currentTab={CreateFromDSLModalTab.FROM_URL} />)
      const fileTab = screen.getByText(/importFromDSLFile/i)

      fireEvent.click(fileTab)

      // bind() prepends the bound argument, so setCurrentTab is called with (FROM_FILE, event)
      expect(defaultProps.setCurrentTab).toHaveBeenCalledWith(
        CreateFromDSLModalTab.FROM_FILE,
        expect.anything(),
      )
    })

    it('should call setCurrentTab with FROM_URL when URL tab is clicked', () => {
      render(<Tab {...defaultProps} currentTab={CreateFromDSLModalTab.FROM_FILE} />)
      const urlTab = screen.getByText(/importFromDSLUrl/i)

      fireEvent.click(urlTab)

      // bind() prepends the bound argument, so setCurrentTab is called with (FROM_URL, event)
      expect(defaultProps.setCurrentTab).toHaveBeenCalledWith(
        CreateFromDSLModalTab.FROM_URL,
        expect.anything(),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      const { container } = render(<Tab {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('system-md-semibold', 'flex', 'h-9', 'items-center', 'gap-x-6')
    })

    it('should have border bottom', () => {
      const { container } = render(<Tab {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('border-b', 'border-divider-subtle')
    })

    it('should have padding', () => {
      const { container } = render(<Tab {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('px-6')
    })
  })
})
