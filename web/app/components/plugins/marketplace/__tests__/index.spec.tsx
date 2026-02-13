import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/query-client', () => ({
  TanstackQueryInitializer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tanstack-initializer">{children}</div>
  ),
}))

vi.mock('../hydration-server', () => ({
  HydrateQueryClient: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hydration-client">{children}</div>
  ),
}))

vi.mock('../description', () => ({
  default: () => <div data-testid="description">Description</div>,
}))

vi.mock('../list/list-wrapper', () => ({
  default: ({ showInstallButton }: { showInstallButton: boolean }) => (
    <div data-testid="list-wrapper" data-show-install={showInstallButton}>ListWrapper</div>
  ),
}))

vi.mock('../sticky-search-and-switch-wrapper', () => ({
  default: ({ pluginTypeSwitchClassName }: { pluginTypeSwitchClassName?: string }) => (
    <div data-testid="sticky-wrapper" data-classname={pluginTypeSwitchClassName}>StickyWrapper</div>
  ),
}))

describe('Marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export a default async component', async () => {
    const mod = await import('../index')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default).toBe('function')
  })

  it('should render all child components with default props', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({})

    const { getByTestId } = render(element as React.ReactElement)

    expect(getByTestId('tanstack-initializer')).toBeInTheDocument()
    expect(getByTestId('hydration-client')).toBeInTheDocument()
    expect(getByTestId('description')).toBeInTheDocument()
    expect(getByTestId('sticky-wrapper')).toBeInTheDocument()
    expect(getByTestId('list-wrapper')).toBeInTheDocument()
  })

  it('should pass showInstallButton=true by default to ListWrapper', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({})

    const { getByTestId } = render(element as React.ReactElement)

    const listWrapper = getByTestId('list-wrapper')
    expect(listWrapper.getAttribute('data-show-install')).toBe('true')
  })

  it('should pass showInstallButton=false when specified', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({ showInstallButton: false })

    const { getByTestId } = render(element as React.ReactElement)

    const listWrapper = getByTestId('list-wrapper')
    expect(listWrapper.getAttribute('data-show-install')).toBe('false')
  })

  it('should pass pluginTypeSwitchClassName to StickySearchAndSwitchWrapper', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({ pluginTypeSwitchClassName: 'top-14' })

    const { getByTestId } = render(element as React.ReactElement)

    const stickyWrapper = getByTestId('sticky-wrapper')
    expect(stickyWrapper.getAttribute('data-classname')).toBe('top-14')
  })

  it('should render without pluginTypeSwitchClassName', async () => {
    const Marketplace = (await import('../index')).default
    const element = await Marketplace({})

    const { getByTestId } = render(element as React.ReactElement)

    const stickyWrapper = getByTestId('sticky-wrapper')
    expect(stickyWrapper.getAttribute('data-classname')).toBeNull()
  })
})
