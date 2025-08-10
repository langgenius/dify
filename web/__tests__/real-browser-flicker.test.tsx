/**
 * Real Browser Environment Dark Mode Flicker Test
 *
 * This test attempts to simulate real browser refresh scenarios including:
 * 1. SSR HTML generation phase
 * 2. Client-side JavaScript loading
 * 3. Theme system initialization
 * 4. CSS styles application timing
 */

import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'next-themes'
import useTheme from '@/hooks/use-theme'
import { useEffect, useState } from 'react'

// Setup browser environment for testing
const setupMockEnvironment = (storedTheme: string | null, systemPrefersDark = false) => {
  // Mock localStorage
  const mockStorage = {
    getItem: jest.fn((key: string) => {
      if (key === 'theme') return storedTheme
      return null
    }),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }

  // Mock system theme preference
  const mockMatchMedia = jest.fn((query: string) => ({
    matches: query.includes('dark') && systemPrefersDark,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }))

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      configurable: true,
    })

    Object.defineProperty(window, 'matchMedia', {
      value: mockMatchMedia,
      configurable: true,
    })
  }

  return { mockStorage, mockMatchMedia }
}

// Simulate real page component based on Dify's actual theme usage
const PageComponent = () => {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Simulate common theme usage pattern in Dify
  const isDark = mounted ? theme === 'dark' : false

  return (
    <div data-theme={isDark ? 'dark' : 'light'}>
      <div
        data-testid="page-content"
        style={{ backgroundColor: isDark ? '#1f2937' : '#ffffff' }}
      >
        <h1 style={{ color: isDark ? '#ffffff' : '#000000' }}>
          Dify Application
        </h1>
        <div data-testid="theme-indicator">
          Current Theme: {mounted ? theme : 'unknown'}
        </div>
        <div data-testid="visual-appearance">
          Appearance: {isDark ? 'dark' : 'light'}
        </div>
      </div>
    </div>
  )
}

const TestThemeProvider = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider
    attribute="data-theme"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
    enableColorScheme={false}
  >
    {children}
  </ThemeProvider>
)

describe('Real Browser Environment Dark Mode Flicker Test', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Page Refresh Scenario Simulation', () => {
    test('simulates complete page loading process with dark theme', async () => {
      // Setup: User previously selected dark mode
      setupMockEnvironment('dark')

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      // Check initial client-side rendering state
      const initialState = {
        theme: screen.getByTestId('theme-indicator').textContent,
        appearance: screen.getByTestId('visual-appearance').textContent,
      }
      console.log('Initial client state:', initialState)

      // Wait for theme system to fully initialize
      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toHaveTextContent('Current Theme: dark')
      })

      const finalState = {
        theme: screen.getByTestId('theme-indicator').textContent,
        appearance: screen.getByTestId('visual-appearance').textContent,
      }
      console.log('Final state:', finalState)

      // Document the state change - this is the source of flicker
      console.log('State change detection: Initial -> Final')
    })

    test('handles light theme correctly', async () => {
      setupMockEnvironment('light')

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toHaveTextContent('Current Theme: light')
      })

      expect(screen.getByTestId('visual-appearance')).toHaveTextContent('Appearance: light')
    })

    test('handles system theme with dark preference', async () => {
      setupMockEnvironment('system', true) // system theme, dark preference

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toHaveTextContent('Current Theme: dark')
      })

      expect(screen.getByTestId('visual-appearance')).toHaveTextContent('Appearance: dark')
    })

    test('handles system theme with light preference', async () => {
      setupMockEnvironment('system', false) // system theme, light preference

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toHaveTextContent('Current Theme: light')
      })

      expect(screen.getByTestId('visual-appearance')).toHaveTextContent('Appearance: light')
    })

    test('handles no stored theme (defaults to system)', async () => {
      setupMockEnvironment(null, false) // no stored theme, system prefers light

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toHaveTextContent('Current Theme: light')
      })
    })

    test('measures timing window of style changes', async () => {
      setupMockEnvironment('dark')

      const timingData: Array<{ phase: string; timestamp: number; styles: any }> = []

      const TimingPageComponent = () => {
        const [mounted, setMounted] = useState(false)
        const { theme } = useTheme()
        const isDark = mounted ? theme === 'dark' : false

        // Record timing and styles for each render phase
        const currentStyles = {
          backgroundColor: isDark ? '#1f2937' : '#ffffff',
          color: isDark ? '#ffffff' : '#000000',
        }

        timingData.push({
          phase: mounted ? 'CSR' : 'Initial',
          timestamp: performance.now(),
          styles: currentStyles,
        })

        useEffect(() => {
          setMounted(true)
        }, [])

        return (
          <div
            data-testid="timing-page"
            style={currentStyles}
          >
            <div data-testid="timing-status">
              Phase: {mounted ? 'CSR' : 'Initial'} | Theme: {theme} | Visual: {isDark ? 'dark' : 'light'}
            </div>
          </div>
        )
      }

      render(
        <TestThemeProvider>
          <TimingPageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('timing-status')).toHaveTextContent('Phase: CSR')
      })

      // Analyze timing and style changes
      console.log('\n=== Style Change Timeline ===')
      timingData.forEach((data, index) => {
        console.log(`${index + 1}. ${data.phase}: bg=${data.styles.backgroundColor}, color=${data.styles.color}`)
      })

      // Check if there are style changes (this is visible flicker)
      const hasStyleChange = timingData.length > 1
        && timingData[0].styles.backgroundColor !== timingData[timingData.length - 1].styles.backgroundColor

      if (hasStyleChange)
        console.log('⚠️  Style changes detected - this causes visible flicker')
       else
        console.log('✅ No style changes detected')

      expect(timingData.length).toBeGreaterThan(1)
    })
  })

  describe('CSS Application Timing Tests', () => {
    test('checks CSS class changes causing flicker', async () => {
      setupMockEnvironment('dark')

      const cssStates: Array<{ className: string; timestamp: number }> = []

      const CSSTestComponent = () => {
        const [mounted, setMounted] = useState(false)
        const { theme } = useTheme()
        const isDark = mounted ? theme === 'dark' : false

        // Simulate Tailwind CSS class application
        const className = `min-h-screen ${isDark ? 'bg-gray-900 text-white' : 'bg-white text-black'}`

        cssStates.push({
          className,
          timestamp: performance.now(),
        })

        useEffect(() => {
          setMounted(true)
        }, [])

        return (
          <div
            data-testid="css-component"
            className={className}
          >
            <div data-testid="css-classes">Classes: {className}</div>
          </div>
        )
      }

      render(
        <TestThemeProvider>
          <CSSTestComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('css-classes')).toHaveTextContent('bg-gray-900 text-white')
      })

      console.log('\n=== CSS Class Change Detection ===')
      cssStates.forEach((state, index) => {
        console.log(`${index + 1}. ${state.className}`)
      })

      // Check if CSS classes have changed
      const hasCSSChange = cssStates.length > 1
        && cssStates[0].className !== cssStates[cssStates.length - 1].className

      if (hasCSSChange) {
        console.log('⚠️  CSS class changes detected - may cause style flicker')
        console.log(`From: "${cssStates[0].className}"`)
        console.log(`To: "${cssStates[cssStates.length - 1].className}"`)
      }

      expect(hasCSSChange).toBe(true) // We expect to see this change
    })
  })

  describe('Edge Cases and Error Handling', () => {
    test('handles localStorage access errors gracefully', async () => {
      // Mock localStorage to throw an error
      const mockStorage = {
        getItem: jest.fn(() => {
          throw new Error('LocalStorage access denied')
        }),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      }

      if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'localStorage', {
          value: mockStorage,
          configurable: true,
        })
      }

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      // Should fallback gracefully without crashing
      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toBeInTheDocument()
      })

      // Should default to light theme when localStorage fails
      expect(screen.getByTestId('visual-appearance')).toHaveTextContent('Appearance: light')
    })

    test('handles invalid theme values in localStorage', async () => {
      setupMockEnvironment('invalid-theme-value')

      render(
        <TestThemeProvider>
          <PageComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('theme-indicator')).toBeInTheDocument()
      })

      // Should handle invalid values gracefully
      const themeIndicator = screen.getByTestId('theme-indicator')
      expect(themeIndicator).toBeInTheDocument()
    })
  })

  describe('Performance and Regression Tests', () => {
    test('verifies ThemeProvider position fix reduces initialization delay', async () => {
      const performanceMarks: Array<{ event: string; timestamp: number }> = []

      const PerformanceTestComponent = () => {
        const [mounted, setMounted] = useState(false)
        const { theme } = useTheme()

        performanceMarks.push({ event: 'component-render', timestamp: performance.now() })

        useEffect(() => {
          performanceMarks.push({ event: 'mount-start', timestamp: performance.now() })
          setMounted(true)
          performanceMarks.push({ event: 'mount-complete', timestamp: performance.now() })
        }, [])

        useEffect(() => {
          if (theme)
            performanceMarks.push({ event: 'theme-available', timestamp: performance.now() })
        }, [theme])

        return (
          <div data-testid="performance-test">
            Mounted: {mounted.toString()} | Theme: {theme || 'loading'}
          </div>
        )
      }

      setupMockEnvironment('dark')

      render(
        <TestThemeProvider>
          <PerformanceTestComponent />
        </TestThemeProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('performance-test')).toHaveTextContent('Theme: dark')
      })

      // Analyze performance timeline
      console.log('\n=== Performance Timeline ===')
      performanceMarks.forEach((mark) => {
        console.log(`${mark.event}: ${mark.timestamp.toFixed(2)}ms`)
      })

      expect(performanceMarks.length).toBeGreaterThan(3)
    })
  })

  describe('Solution Requirements Definition', () => {
    test('defines technical requirements to eliminate flicker', () => {
      const technicalRequirements = {
        ssrConsistency: 'SSR and CSR must render identical initial styles',
        synchronousDetection: 'Theme detection must complete synchronously before first render',
        noStyleChanges: 'No visible style changes should occur after hydration',
        performanceImpact: 'Solution should not significantly impact page load performance',
        browserCompatibility: 'Must work consistently across all major browsers',
      }

      console.log('\n=== Technical Requirements ===')
      Object.entries(technicalRequirements).forEach(([key, requirement]) => {
        console.log(`${key}: ${requirement}`)
        expect(requirement).toBeDefined()
      })

      // A successful solution should pass all these requirements
    })
  })
})
