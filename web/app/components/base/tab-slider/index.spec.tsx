import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstalledPluginList } from '@/service/use-plugins'
import TabSlider from './index'

// Mock the service hook
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: vi.fn(),
}))

const mockOptions = [
  { value: 'all', text: 'All' },
  { value: 'plugins', text: 'Plugins' },
  { value: 'settings', text: 'Settings' },
]

describe('TabSlider Component', () => {
  const onChangeMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { total: 0 },
      isLoading: false,
    } as ReturnType<typeof useInstalledPluginList>)
  })

  afterEach(() => {
    cleanup()
  })

  // Helper to inject layout values into JSDOM
  const setElementLayout = (id: string, left: number, width: number) => {
    const el = document.getElementById(id)
    if (el) {
      Object.defineProperty(el, 'offsetLeft', { configurable: true, value: left })
      Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
    }
  }

  it('renders all options correctly', () => {
    render(<TabSlider value="all" options={mockOptions} onChange={onChangeMock} />)
    mockOptions.forEach((option) => {
      expect(screen.getByText(option.text as string)).toBeInTheDocument()
    })
  })

  it('calls onChange when a new tab is clicked', () => {
    render(<TabSlider value="all" options={mockOptions} onChange={onChangeMock} />)
    const pluginTab = screen.getByTestId('tab-item-plugins')
    fireEvent.click(pluginTab)
    expect(onChangeMock).toHaveBeenCalledWith('plugins')
  })

  it('applies the correct active classes to the selected tab', () => {
    render(<TabSlider value="plugins" options={mockOptions} onChange={onChangeMock} />)
    const activeTab = screen.getByTestId('tab-item-plugins')
    expect(activeTab).toHaveClass('text-text-primary')

    const inactiveTab = screen.getByTestId('tab-item-all')
    expect(inactiveTab).toHaveClass('text-text-tertiary')
  })

  it('renders the Badge when plugins exist and value is "plugins"', () => {
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { total: 5 },
      isLoading: false,
    } as ReturnType<typeof useInstalledPluginList>)

    render(<TabSlider value="all" options={mockOptions} onChange={onChangeMock} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('supports functional itemClassName based on active state', () => {
    render(
      <TabSlider
        value="all"
        options={mockOptions}
        onChange={onChangeMock}
        itemClassName={active => (active ? 'is-active-custom' : 'is-inactive-custom')}
      />,
    )
    expect(screen.getByTestId('tab-item-all')).toHaveClass('is-active-custom')
    expect(screen.getByTestId('tab-item-settings')).toHaveClass('is-inactive-custom')
  })

  it('updates slider styles based on element dimensions', () => {
    // 1. Initial Render
    const { rerender } = render(
      <TabSlider value="all" options={mockOptions} onChange={onChangeMock} />,
    )

    // 2. Mock layout properties for the elements now that they are in the DOM
    setElementLayout('tab-0', 0, 100)
    setElementLayout('tab-1', 120, 80)

    // 3. Rerender with the same or new value to trigger the useEffect
    // This forces updateSliderStyle to run while the mocked values exist
    rerender(<TabSlider value="plugins" options={mockOptions} onChange={onChangeMock} />)

    const slider = screen.getByTestId('tab-slider-bg')

    // Assert the transform matches the "tab-1" (plugins) layout we mocked
    expect(slider.style.transform).toBe('translateX(120px)')
    expect(slider.style.width).toBe('80px')
  })
})
