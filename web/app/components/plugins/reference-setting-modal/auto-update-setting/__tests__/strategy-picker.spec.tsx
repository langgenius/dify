import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StrategyPicker from '../strategy-picker'
import { AUTO_UPDATE_STRATEGY } from '../types'

const triggerName = (key: string) => new RegExp(`plugin\\.autoUpdate\\.strategy\\.${key}\\.name`, 'i')

describe('StrategyPicker', () => {
  it('renders all strategy toggle options', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'plugin.autoUpdate.automaticUpdates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: triggerName('disabled') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: triggerName('fixOnly') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: triggerName('latest') })).toBeInTheDocument()
  })

  it('marks only the currently selected strategy as pressed', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    const buttons = screen.getAllByRole('button')
    const pressedOptions = buttons.filter(item => item.getAttribute('aria-pressed') === 'true')

    expect(pressedOptions).toHaveLength(1)
    expect(pressedOptions[0]).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name')
  })

  it('calls onChange when a new strategy is selected', async () => {
    const onChange = vi.fn()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: triggerName('latest') }))

    expect(onChange).toHaveBeenCalledWith(AUTO_UPDATE_STRATEGY.latest)
  })
})
