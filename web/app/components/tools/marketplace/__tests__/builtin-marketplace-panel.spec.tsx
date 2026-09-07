import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BuiltinMarketplacePanel } from '../builtin-marketplace-panel'

const mockUseMarketplace = vi.fn()
const intersectionObserverCallbacks: IntersectionObserverCallback[] = []

vi.mock('@/app/components/tools/marketplace/hooks', () => ({
  useMarketplace: (...args: unknown[]) => mockUseMarketplace(...args),
}))

vi.mock('@/app/components/tools/marketplace', () => ({
  default: ({ showMarketplacePanel }: { showMarketplacePanel: () => void }) => (
    <button type="button" onClick={showMarketplacePanel}>
      Marketplace
    </button>
  ),
}))

describe('BuiltinMarketplacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    intersectionObserverCallbacks.length = 0
    mockUseMarketplace.mockReturnValue({ handleScroll: vi.fn() })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionObserverCallbacks.push(callback)
        }

        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderPanel = (overrides?: { keywords?: string; tagFilterValue?: string[] }) => {
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <div ref={containerRef}>
        <BuiltinMarketplacePanel
          containerRef={containerRef}
          contentInset="default"
          keywords={overrides?.keywords ?? ''}
          tagFilterValue={overrides?.tagFilterValue ?? []}
        />
      </div>,
    )

    return { container, containerRef }
  }

  it('defers Marketplace queries until the section enters the viewport', () => {
    renderPanel()

    expect(mockUseMarketplace).toHaveBeenLastCalledWith('', [], false)

    act(() => {
      intersectionObserverCallbacks[0]?.(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      )
    })

    expect(mockUseMarketplace).toHaveBeenLastCalledWith('', [], true)
  })

  it('loads Marketplace immediately when the user searches', () => {
    renderPanel({ keywords: 'weather' })

    expect(mockUseMarketplace).toHaveBeenLastCalledWith('weather', [], true)
  })

  it('loads Marketplace immediately when the user filters by tag', () => {
    renderPanel({ tagFilterValue: ['search'] })

    expect(mockUseMarketplace).toHaveBeenLastCalledWith('', ['search'], true)
  })

  it('activates Marketplace before scrolling to it from the arrow action', () => {
    const { containerRef } = renderPanel()
    containerRef.current!.scrollTo = vi.fn()

    fireEvent.click(screen.getByRole('button', { name: 'Marketplace' }))

    expect(mockUseMarketplace).toHaveBeenLastCalledWith('', [], true)
    expect(containerRef.current!.scrollTo).toHaveBeenCalledWith({ top: -80, behavior: 'smooth' })
  })
})
