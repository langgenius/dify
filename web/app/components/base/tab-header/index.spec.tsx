import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TabHeader from './index'

describe('TabHeader Component', () => {
  const mockItems = [
    { id: 'tab1', name: 'General' },
    { id: 'tab2', name: 'Settings' },
    { id: 'tab3', name: 'Profile', isRight: true },
    { id: 'tab4', name: 'Disabled Tab', disabled: true },
  ]

  it('should render all items with correct names', () => {
    render(<TabHeader items={mockItems} value="tab1" onChange={() => { }} />)

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText('Disabled Tab')).toBeInTheDocument()
  })

  it('should separate items into left and right containers correctly', () => {
    render(<TabHeader items={mockItems} value="tab1" onChange={() => { }} />)

    const leftContainer = screen.getByTestId('tab-header-left')
    const rightContainer = screen.getByTestId('tab-header-right')

    // Verify children count
    expect(leftContainer.children.length).toBe(3)
    expect(rightContainer.children.length).toBe(1)

    // Verify specific item placement using within and toContainElement
    const profileTab = screen.getByTestId('tab-header-item-tab3')
    expect(rightContainer).toContainElement(profileTab)

    const disabledTab = screen.getByTestId('tab-header-item-tab4')
    expect(leftContainer).toContainElement(disabledTab)
  })

  it('should apply active styles to the selected tab', () => {
    const activeClass = 'custom-active-style'
    render(
      <TabHeader
        items={mockItems}
        value="tab2"
        activeItemClassName={activeClass}
        onChange={() => { }}
      />,
    )

    const activeTab = screen.getByTestId('tab-header-item-tab2')
    expect(activeTab).toHaveClass('border-components-tab-active')
    expect(activeTab).toHaveClass(activeClass)

    const inactiveTab = screen.getByTestId('tab-header-item-tab1')
    expect(inactiveTab).toHaveClass('text-text-tertiary')
  })

  it('should call onChange when a non-disabled tab is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<TabHeader items={mockItems} value="tab1" onChange={handleChange} />)

    await user.click(screen.getByText('Settings'))
    expect(handleChange).toHaveBeenCalledWith('tab2')
  })

  it('should not call onChange when a disabled tab is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<TabHeader items={mockItems} value="tab1" onChange={handleChange} />)

    const disabledTab = screen.getByTestId('tab-header-item-tab4')
    expect(disabledTab).toHaveClass('cursor-not-allowed')

    await user.click(disabledTab)
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('should render icon and extra content when provided', () => {
    const itemsWithExtras = [
      {
        id: 'extra',
        name: 'Extra',
        icon: <span data-testid="tab-icon">🚀</span>,
        extra: <span data-testid="tab-extra">New</span>,
      },
    ]
    render(<TabHeader items={itemsWithExtras} value="extra" onChange={() => { }} />)

    expect(screen.getByTestId('tab-icon')).toBeInTheDocument()
    expect(screen.getByTestId('tab-extra')).toBeInTheDocument()
  })

  it('should apply custom class names for items and wrappers', () => {
    render(
      <TabHeader
        items={mockItems}
        value="tab1"
        itemClassName="my-text-class"
        itemWrapClassName="my-wrap-class"
        onChange={() => { }}
      />,
    )

    const tabWrap = screen.getByTestId('tab-header-item-tab1')
    // We target the inner div for the name class check
    const tabText = within(tabWrap).getByText('General')

    expect(tabWrap).toHaveClass('my-wrap-class')
    expect(tabText).toHaveClass('my-text-class')
  })
})
