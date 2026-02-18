import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TabSlider from './index'

describe('TabSlider Component', () => {
  const mockOptions = [
    { value: 'tab1', text: 'Overview' },
    { value: 'tab2', text: 'Settings' },
    { value: 'tab3', text: <span data-testid="custom-jsx">Advanced</span> },
  ]

  it('should render all options correctly', () => {
    render(<TabSlider value="tab1" options={mockOptions} onChange={() => { }} />)

    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTestId('custom-jsx')).toBeInTheDocument()
  })

  it('should call onChange when an inactive tab is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<TabSlider value="tab1" options={mockOptions} onChange={handleChange} />)

    const settingsTab = screen.getByTestId('tab-slider-item-tab2')
    await user.click(settingsTab)

    expect(handleChange).toHaveBeenCalledWith('tab2')
  })

  it('should not call onChange when the active tab is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<TabSlider value="tab1" options={mockOptions} onChange={handleChange} />)

    const activeTab = screen.getByTestId('tab-slider-item-tab1')
    await user.click(activeTab)

    expect(handleChange).not.toHaveBeenCalled()
  })

  it('should apply active styles and render indicator for the active tab', () => {
    render(<TabSlider value="tab2" options={mockOptions} onChange={() => { }} />)

    const activeTab = screen.getByTestId('tab-slider-item-tab2')
    const activeText = within(activeTab).getByTestId('tab-slider-item-text')
    const indicator = within(activeTab).getByTestId('tab-active-indicator')

    expect(activeText).toHaveClass('text-text-primary')
    expect(indicator).toBeInTheDocument()

    const inactiveTab = screen.getByTestId('tab-slider-item-tab1')
    const inactiveText = within(inactiveTab).getByTestId('tab-slider-item-text')
    expect(inactiveText).toHaveClass('text-text-tertiary')
    expect(within(inactiveTab).queryByTestId('tab-active-indicator')).not.toBeInTheDocument()
  })

  it('should apply smallItem styles when smallItem prop is true', () => {
    render(<TabSlider value="tab1" options={mockOptions} onChange={() => { }} smallItem />)

    const item = screen.getByTestId('tab-slider-item-tab1')
    expect(item).toHaveClass('system-sm-semibold-uppercase')
    expect(item).not.toHaveClass('system-xl-semibold')
  })

  it('should apply standard sizing when smallItem prop is false', () => {
    render(<TabSlider value="tab1" options={mockOptions} onChange={() => { }} />)

    const item = screen.getByTestId('tab-slider-item-tab1')
    expect(item).toHaveClass('system-xl-semibold')
  })

  it('should handle border styles based on noBorderBottom prop', () => {
    const { rerender } = render(
      <TabSlider value="tab1" options={mockOptions} onChange={() => { }} />,
    )
    expect(screen.getByTestId('tab-slider')).toHaveClass('border-b')

    rerender(
      <TabSlider value="tab1" options={mockOptions} onChange={() => { }} noBorderBottom />,
    )
    expect(screen.getByTestId('tab-slider')).not.toHaveClass('border-b')
  })

  it('should apply custom itemClassName to all items', () => {
    const customClass = 'my-custom-item'
    render(
      <TabSlider
        value="tab1"
        options={mockOptions}
        onChange={() => { }}
        itemClassName={customClass}
      />,
    )

    expect(screen.getByTestId('tab-slider-item-tab1')).toHaveClass(customClass)
    expect(screen.getByTestId('tab-slider-item-tab2')).toHaveClass(customClass)
  })
})
