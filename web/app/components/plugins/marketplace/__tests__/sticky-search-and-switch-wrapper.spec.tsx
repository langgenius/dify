import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import StickySearchAndSwitchWrapper from '../sticky-search-and-switch-wrapper'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock child components to isolate wrapper logic
vi.mock('../plugin-type-switch', () => ({
  default: () => <div data-testid="plugin-type-switch">PluginTypeSwitch</div>,
}))

vi.mock('../search-box/search-box-wrapper', () => ({
  default: () => <div data-testid="search-box-wrapper">SearchBoxWrapper</div>,
}))

const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
const Wrapper = ({ children }: { children: ReactNode }) => (
  <JotaiProvider>
    <NuqsWrapper>
      {children}
    </NuqsWrapper>
  </JotaiProvider>
)

describe('StickySearchAndSwitchWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render SearchBoxWrapper and PluginTypeSwitch', () => {
    const { getByTestId } = render(
      <StickySearchAndSwitchWrapper />,
      { wrapper: Wrapper },
    )

    expect(getByTestId('search-box-wrapper')).toBeInTheDocument()
    expect(getByTestId('plugin-type-switch')).toBeInTheDocument()
  })

  it('should not apply sticky class when no pluginTypeSwitchClassName', () => {
    const { container } = render(
      <StickySearchAndSwitchWrapper />,
      { wrapper: Wrapper },
    )

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.className).toContain('mt-4')
    expect(outerDiv.className).not.toContain('sticky')
  })

  it('should apply sticky class when pluginTypeSwitchClassName contains top-', () => {
    const { container } = render(
      <StickySearchAndSwitchWrapper pluginTypeSwitchClassName="top-10" />,
      { wrapper: Wrapper },
    )

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.className).toContain('sticky')
    expect(outerDiv.className).toContain('z-10')
    expect(outerDiv.className).toContain('top-10')
  })

  it('should not apply sticky class when pluginTypeSwitchClassName does not contain top-', () => {
    const { container } = render(
      <StickySearchAndSwitchWrapper pluginTypeSwitchClassName="custom-class" />,
      { wrapper: Wrapper },
    )

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.className).not.toContain('sticky')
    expect(outerDiv.className).toContain('custom-class')
  })
})
