import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Tab from './index'

// Define enum locally to avoid importing the whole module
enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

// Mock the create-from-dsl-modal module to export the enum
jest.mock('@/app/components/app/create-from-dsl-modal', () => ({
  CreateFromDSLModalTab: {
    FROM_FILE: 'from-file',
    FROM_URL: 'from-url',
  },
}))

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('Tab', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      expect(screen.getByText('app.importFromDSLFile')).toBeInTheDocument()
      expect(screen.getByText('app.importFromDSLUrl')).toBeInTheDocument()
    })

    it('should render two tab items', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Should have 2 clickable tab items
      const tabItems = container.querySelectorAll('.cursor-pointer')
      expect(tabItems.length).toBe(2)
    })

    it('should render with correct container styling', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const tabContainer = container.firstChild as HTMLElement
      expect(tabContainer).toHaveClass('flex')
      expect(tabContainer).toHaveClass('h-9')
      expect(tabContainer).toHaveClass('items-center')
      expect(tabContainer).toHaveClass('gap-x-6')
      expect(tabContainer).toHaveClass('border-b')
      expect(tabContainer).toHaveClass('border-divider-subtle')
      expect(tabContainer).toHaveClass('px-6')
    })

    it('should render tab labels with translation keys', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      expect(screen.getByText('app.importFromDSLFile')).toBeInTheDocument()
      expect(screen.getByText('app.importFromDSLUrl')).toBeInTheDocument()
    })
  })

  // Tests for active tab indication
  describe('Active Tab Indication', () => {
    it('should show FROM_FILE tab as active when currentTab is FROM_FILE', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // getByText returns the Item element directly (text is inside it)
      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      // Active tab should have text-text-primary class
      expect(fileTab).toHaveClass('text-text-primary')
      // Inactive tab should have text-text-tertiary class
      expect(urlTab).toHaveClass('text-text-tertiary')
      expect(urlTab).not.toHaveClass('text-text-primary')
    })

    it('should show FROM_URL tab as active when currentTab is FROM_URL', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      // Inactive tab should have text-text-tertiary class
      expect(fileTab).toHaveClass('text-text-tertiary')
      expect(fileTab).not.toHaveClass('text-text-primary')
      // Active tab should have text-text-primary class
      expect(urlTab).toHaveClass('text-text-primary')
    })

    it('should render active indicator bar for active tab', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Active tab should have the indicator bar
      const indicatorBars = container.querySelectorAll('.bg-util-colors-blue-brand-blue-brand-600')
      expect(indicatorBars.length).toBe(1)
    })

    it('should render active indicator bar for URL tab when active', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Should have one indicator bar
      const indicatorBars = container.querySelectorAll('.bg-util-colors-blue-brand-blue-brand-600')
      expect(indicatorBars.length).toBe(1)

      // The indicator should be in the URL tab
      const urlTab = screen.getByText('app.importFromDSLUrl')
      expect(urlTab.querySelector('.bg-util-colors-blue-brand-blue-brand-600')).toBeInTheDocument()
    })

    it('should not render indicator bar for inactive tab', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // The URL tab (inactive) should not have an indicator bar
      const urlTab = screen.getByText('app.importFromDSLUrl')
      expect(urlTab.querySelector('.bg-util-colors-blue-brand-blue-brand-600')).not.toBeInTheDocument()
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should call setCurrentTab with FROM_FILE when file tab is clicked', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      fireEvent.click(fileTab)

      expect(setCurrentTab).toHaveBeenCalledTimes(1)
      // .bind() passes tab.key as first arg, event as second
      expect(setCurrentTab).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_FILE, expect.anything())
    })

    it('should call setCurrentTab with FROM_URL when url tab is clicked', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const urlTab = screen.getByText('app.importFromDSLUrl')
      fireEvent.click(urlTab)

      expect(setCurrentTab).toHaveBeenCalledTimes(1)
      expect(setCurrentTab).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_URL, expect.anything())
    })

    it('should call setCurrentTab when clicking already active tab', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      fireEvent.click(fileTab)

      // Should still call setCurrentTab even for active tab
      expect(setCurrentTab).toHaveBeenCalledTimes(1)
      expect(setCurrentTab).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_FILE, expect.anything())
    })

    it('should handle multiple tab clicks', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      fireEvent.click(urlTab)
      fireEvent.click(fileTab)
      fireEvent.click(urlTab)

      expect(setCurrentTab).toHaveBeenCalledTimes(3)
      expect(setCurrentTab).toHaveBeenNthCalledWith(1, CreateFromDSLModalTab.FROM_URL, expect.anything())
      expect(setCurrentTab).toHaveBeenNthCalledWith(2, CreateFromDSLModalTab.FROM_FILE, expect.anything())
      expect(setCurrentTab).toHaveBeenNthCalledWith(3, CreateFromDSLModalTab.FROM_URL, expect.anything())
    })
  })

  // Tests for props variations
  describe('Props Variations', () => {
    it('should handle FROM_FILE as currentTab prop', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      expect(fileTab).toHaveClass('text-text-primary')
    })

    it('should handle FROM_URL as currentTab prop', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      const urlTab = screen.getByText('app.importFromDSLUrl')
      expect(urlTab).toHaveClass('text-text-primary')
    })

    it('should work with different setCurrentTab callback functions', () => {
      const setCurrentTab1 = jest.fn()
      const { rerender } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab1}
        />,
      )

      fireEvent.click(screen.getByText('app.importFromDSLUrl'))
      expect(setCurrentTab1).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_URL, expect.anything())

      const setCurrentTab2 = jest.fn()
      rerender(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab2}
        />,
      )

      fireEvent.click(screen.getByText('app.importFromDSLUrl'))
      expect(setCurrentTab2).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_URL, expect.anything())
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle component mounting without errors', () => {
      const setCurrentTab = jest.fn()
      expect(() =>
        render(
          <Tab
            currentTab={CreateFromDSLModalTab.FROM_FILE}
            setCurrentTab={setCurrentTab}
          />,
        ),
      ).not.toThrow()
    })

    it('should handle component unmounting without errors', () => {
      const setCurrentTab = jest.fn()
      const { unmount } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      expect(() => unmount()).not.toThrow()
    })

    it('should handle currentTab prop change', () => {
      const setCurrentTab = jest.fn()
      const { rerender } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Initially FROM_FILE is active
      let fileTab = screen.getByText('app.importFromDSLFile')
      expect(fileTab).toHaveClass('text-text-primary')

      // Change to FROM_URL
      rerender(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Now FROM_URL should be active
      const urlTab = screen.getByText('app.importFromDSLUrl')
      fileTab = screen.getByText('app.importFromDSLFile')
      expect(urlTab).toHaveClass('text-text-primary')
      expect(fileTab).not.toHaveClass('text-text-primary')
    })

    it('should handle multiple rerenders', () => {
      const setCurrentTab = jest.fn()
      const { rerender } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      rerender(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_URL}
          setCurrentTab={setCurrentTab}
        />,
      )

      rerender(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      expect(fileTab).toHaveClass('text-text-primary')
    })

    it('should maintain DOM structure after multiple interactions', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const initialTabCount = container.querySelectorAll('.cursor-pointer').length

      // Multiple clicks
      fireEvent.click(screen.getByText('app.importFromDSLUrl'))
      fireEvent.click(screen.getByText('app.importFromDSLFile'))

      const afterClicksTabCount = container.querySelectorAll('.cursor-pointer').length
      expect(afterClicksTabCount).toBe(initialTabCount)
    })
  })

  // Tests for Item component integration
  describe('Item Component Integration', () => {
    it('should render Item components with correct cursor style', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const tabItems = container.querySelectorAll('.cursor-pointer')
      expect(tabItems.length).toBe(2)
    })

    it('should pass correct isActive prop to Item components', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      // File tab should be active
      expect(fileTab).toHaveClass('text-text-primary')
      // URL tab should be inactive
      expect(urlTab).not.toHaveClass('text-text-primary')
    })

    it('should pass correct label to Item components', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      expect(screen.getByText('app.importFromDSLFile')).toBeInTheDocument()
      expect(screen.getByText('app.importFromDSLUrl')).toBeInTheDocument()
    })

    it('should pass correct onClick handler to Item components', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      fireEvent.click(fileTab)
      fireEvent.click(urlTab)

      expect(setCurrentTab).toHaveBeenCalledTimes(2)
      expect(setCurrentTab).toHaveBeenNthCalledWith(1, CreateFromDSLModalTab.FROM_FILE, expect.anything())
      expect(setCurrentTab).toHaveBeenNthCalledWith(2, CreateFromDSLModalTab.FROM_URL, expect.anything())
    })
  })

  // Tests for accessibility
  describe('Accessibility', () => {
    it('should have clickable elements for each tab', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const clickableElements = container.querySelectorAll('.cursor-pointer')
      expect(clickableElements.length).toBe(2)
    })

    it('should have visible text labels for each tab', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileLabel = screen.getByText('app.importFromDSLFile')
      const urlLabel = screen.getByText('app.importFromDSLUrl')

      expect(fileLabel).toBeVisible()
      expect(urlLabel).toBeVisible()
    })

    it('should visually distinguish active tab from inactive tabs', () => {
      const setCurrentTab = jest.fn()
      const { container } = render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      // Active tab has indicator bar
      const indicatorBars = container.querySelectorAll('.bg-util-colors-blue-brand-blue-brand-600')
      expect(indicatorBars.length).toBe(1)

      // Active tab has different text color
      const fileTab = screen.getByText('app.importFromDSLFile')
      expect(fileTab).toHaveClass('text-text-primary')
    })
  })

  // Tests for component stability
  describe('Component Stability', () => {
    it('should handle rapid mount/unmount cycles', () => {
      const setCurrentTab = jest.fn()

      for (let i = 0; i < 5; i++) {
        const { unmount } = render(
          <Tab
            currentTab={CreateFromDSLModalTab.FROM_FILE}
            setCurrentTab={setCurrentTab}
          />,
        )
        unmount()
      }

      expect(true).toBe(true)
    })

    it('should handle rapid tab switching', () => {
      const setCurrentTab = jest.fn()
      render(
        <Tab
          currentTab={CreateFromDSLModalTab.FROM_FILE}
          setCurrentTab={setCurrentTab}
        />,
      )

      const fileTab = screen.getByText('app.importFromDSLFile')
      const urlTab = screen.getByText('app.importFromDSLUrl')

      // Rapid clicks
      for (let i = 0; i < 10; i++)
        fireEvent.click(i % 2 === 0 ? urlTab : fileTab)

      expect(setCurrentTab).toHaveBeenCalledTimes(10)
    })
  })
})
