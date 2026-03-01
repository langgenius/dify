import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TabSliderNew from './index'

describe('TabSliderNew Component', () => {
  const mockOptions = [
    { value: 'all', text: 'All' },
    { value: 'active', text: 'Active' },
    { value: 'inactive', text: 'Inactive', icon: <span data-testid="tab-icon">ico</span> },
  ]

  it('should render all options with text and icons', () => {
    render(
      <TabSliderNew
        value="all"
        options={mockOptions}
        onChange={() => { }}
      />,
    )

    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByTestId('tab-icon')).toBeInTheDocument()
  })

  it('should apply active classes when the value matches the option', () => {
    render(
      <TabSliderNew
        value="active"
        options={mockOptions}
        onChange={() => { }}
      />,
    )

    const activeTab = screen.getByTestId('tab-item-active')
    const inactiveTab = screen.getByTestId('tab-item-all')

    // Check active styles
    expect(activeTab).toHaveClass('border-components-main-nav-nav-button-border')
    expect(activeTab).toHaveClass('text-components-main-nav-nav-button-text-active')

    // Check inactive styles
    expect(inactiveTab).toHaveClass('text-text-tertiary')
    expect(inactiveTab).not.toHaveClass('border-components-main-nav-nav-button-border')
  })

  it('should call onChange with the correct value when a tab is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <TabSliderNew
        value="all"
        options={mockOptions}
        onChange={handleChange}
      />,
    )

    const inactiveTab = screen.getByTestId('tab-item-inactive')
    await user.click(inactiveTab)

    expect(handleChange).toHaveBeenCalledWith('inactive')
    expect(handleChange).toHaveBeenCalledTimes(1)
  })

  it('should apply custom container className', () => {
    const customClass = 'custom-container-style'
    render(
      <TabSliderNew
        value="all"
        options={mockOptions}
        onChange={() => { }}
        className={customClass}
      />,
    )

    expect(screen.getByTestId('tab-slider-new')).toHaveClass(customClass)
  })

  it('should call onChange even if clicking an already active tab', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <TabSliderNew
        value="all"
        options={mockOptions}
        onChange={handleChange}
      />,
    )

    const activeTab = screen.getByTestId('tab-item-all')
    await user.click(activeTab)

    expect(handleChange).toHaveBeenCalledWith('all')
  })
})
