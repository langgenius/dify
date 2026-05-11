import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import PluginTypeSwitch from '../plugin-type-switch'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'category.all': 'All',
        'category.models': 'Models',
        'category.tools': 'Tools',
        'category.datasources': 'Data Sources',
        'category.triggers': 'Triggers',
        'category.agents': 'Agents',
        'category.extensions': 'Extensions',
        'category.bundles': 'Bundles',
      }
      return map[key] || key
    },
  }),
}))

const createWrapper = (searchParams = '') => {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>
        {children}
      </NuqsWrapper>
    </JotaiProvider>
  )
  return { Wrapper }
}

describe('PluginTypeSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all category options', () => {
    const { Wrapper } = createWrapper()
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('Data Sources')).toBeInTheDocument()
    expect(screen.getByText('Triggers')).toBeInTheDocument()
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('Extensions')).toBeInTheDocument()
    expect(screen.getByText('Bundles')).toBeInTheDocument()
  })

  it('should apply active styling to current category', () => {
    const { Wrapper } = createWrapper('?category=all')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    const allButton = screen.getByText('All').closest('div')
    expect(allButton?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
  })

  it('should apply custom className', () => {
    const { Wrapper } = createWrapper()
    const { container } = render(<PluginTypeSwitch className="custom-class" />, { wrapper: Wrapper })

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.className).toContain('custom-class')
  })

  it('should update category when option is clicked', () => {
    const { Wrapper } = createWrapper('?category=all')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    fireEvent.click(screen.getByText('Models'))

    const modelsButton = screen.getByText('Models').closest('div')
    expect(modelsButton?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
  })

  it('should handle clicking on category with collections (Tools)', () => {
    const { Wrapper } = createWrapper('?category=model')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    fireEvent.click(screen.getByText('Tools'))

    const toolsButton = screen.getByText('Tools').closest('div')
    expect(toolsButton?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
  })

  it('should handle clicking on category without collections (Models)', () => {
    const { Wrapper } = createWrapper('?category=all')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    fireEvent.click(screen.getByText('Models'))

    const modelsButton = screen.getByText('Models').closest('div')
    expect(modelsButton?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
  })

  it('should handle clicking on bundles', () => {
    const { Wrapper } = createWrapper('?category=all')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    fireEvent.click(screen.getByText('Bundles'))

    const bundlesButton = screen.getByText('Bundles').closest('div')
    expect(bundlesButton?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
  })

  it('should handle clicking on each category', () => {
    const { Wrapper } = createWrapper('?category=all')
    render(<PluginTypeSwitch />, { wrapper: Wrapper })

    const categories = ['All', 'Models', 'Tools', 'Data Sources', 'Triggers', 'Agents', 'Extensions', 'Bundles']
    categories.forEach((category) => {
      fireEvent.click(screen.getByText(category))

      const button = screen.getByText(category).closest('div')
      expect(button?.className).toContain('bg-components-main-nav-nav-button-bg-active!')
    })
  })

  it('should render icons for categories that have them', () => {
    const { Wrapper } = createWrapper()
    const { container } = render(<PluginTypeSwitch />, { wrapper: Wrapper })

    // "All" has no icon (icon: null), others should have SVG icons
    const svgs = container.querySelectorAll('svg')
    // 7 categories with icons (all categories except "All")
    expect(svgs.length).toBeGreaterThanOrEqual(7)
  })
})
