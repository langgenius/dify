import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StrategyPicker from '../strategy-picker'
import { AUTO_UPDATE_STRATEGY } from '../types'

let portalOpen = false

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({
    children,
  }: {
    children: React.ReactNode
  }) => <span data-testid="picker-button">{children}</span>,
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
    value?: string
    itemValue?: string
    onValueChange?: (value: string) => void
  }>({ open: false })

  return {
    DropdownMenu: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: React.ReactNode
    }) => {
      portalOpen = open
      return (
        <DropdownMenuContext.Provider value={{ open, onOpenChange }}>
          <div>{children}</div>
        </DropdownMenuContext.Provider>
      )
    },
    DropdownMenuTrigger: ({
      children,
    }: {
      children: React.ReactNode
    }) => {
      const { open, onOpenChange } = React.useContext(DropdownMenuContext)
      return (
        <button
          data-testid="trigger"
          onClick={() => onOpenChange?.(!open)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({
      children,
    }: {
      children: React.ReactNode
    }) => portalOpen ? <div data-testid="portal-content">{children}</div> : null,
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode
      value: string
      onValueChange: (value: string) => void
    }) => (
      <DropdownMenuContext.Provider value={{ open: portalOpen, value, onValueChange }}>
        <div role="radiogroup">{children}</div>
      </DropdownMenuContext.Provider>
    ),
    DropdownMenuRadioItem: ({
      children,
      value,
    }: {
      children: React.ReactNode
      value: string
    }) => {
      const { value: selectedValue, onValueChange } = React.useContext(DropdownMenuContext)
      return (
        <DropdownMenuContext.Provider value={{ open: portalOpen, value: selectedValue, itemValue: value, onValueChange }}>
          <button
            role="radio"
            aria-checked={selectedValue === value}
            data-testid={`strategy-option-${value}`}
            onClick={() => onValueChange?.(value)}
          >
            {children}
          </button>
        </DropdownMenuContext.Provider>
      )
    },
    DropdownMenuRadioItemIndicator: () => {
      const { value, itemValue } = React.useContext(DropdownMenuContext)
      return value === itemValue ? <span data-testid="strategy-indicator">✓</span> : null
    },
  }
})

describe('StrategyPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpen = false
  })

  it('renders the selected strategy label in the trigger', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('trigger')).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name')
  })

  it('opens the option list when the trigger is clicked', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger'))

    expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.strategy.latest.description')).toBeInTheDocument()
  })

  it('calls onChange when a new strategy is selected', () => {
    const onChange = vi.fn()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByTestId('trigger'))
    fireEvent.click(screen.getByText('plugin.autoUpdate.strategy.latest.name'))

    expect(onChange).toHaveBeenCalledWith(AUTO_UPDATE_STRATEGY.latest)
  })
})
