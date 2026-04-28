import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StrategyPicker from '../strategy-picker'
import { AUTO_UPDATE_STRATEGY } from '../types'

const triggerName = (key: string) => new RegExp(`plugin\\.autoUpdate\\.strategy\\.${key}\\.name`, 'i')

describe('StrategyPicker', () => {
  it('renders the selected strategy label in the trigger', () => {
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: triggerName('fixOnly') })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the option list when the trigger is clicked', async () => {
    const user = userEvent.setup()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: triggerName('disabled') }))

    const options = await screen.findAllByRole('menuitemradio')
    expect(options).toHaveLength(3)
    expect(screen.getByText('plugin.autoUpdate.strategy.latest.description')).toBeInTheDocument()
  })

  it('marks only the currently selected strategy as checked', async () => {
    const user = userEvent.setup()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.fixOnly}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: triggerName('fixOnly') }))

    const checkedOptions = (await screen.findAllByRole('menuitemradio'))
      .filter(item => item.getAttribute('aria-checked') === 'true')

    expect(checkedOptions).toHaveLength(1)
    expect(checkedOptions[0]).toHaveTextContent('plugin.autoUpdate.strategy.fixOnly.name')
  })

  it('calls onChange and closes the menu when a new strategy is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <StrategyPicker
        value={AUTO_UPDATE_STRATEGY.disabled}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: triggerName('disabled') }))
    const latestOption = (await screen.findAllByRole('menuitemradio'))
      .find(item => item.textContent?.includes('plugin.autoUpdate.strategy.latest.name'))!
    await user.click(latestOption)

    expect(onChange).toHaveBeenCalledWith(AUTO_UPDATE_STRATEGY.latest)
    expect(await screen.findByRole('button', { name: triggerName('disabled') })).toBeInTheDocument()
  })
})
