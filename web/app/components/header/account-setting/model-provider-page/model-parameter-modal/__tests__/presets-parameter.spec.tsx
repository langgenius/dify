import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import PresetsParameter from '../presets-parameter'
import { getSupportedPresetConfig } from '../presets-parameter-utils'

describe('PresetsParameter', () => {
  it('selects a preset', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    await user.click(
      screen.getByRole('button', { name: /modelProvider\.modelProvider\.loadPresets/i }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'common.model.tone.Creative' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('hides presets when none of their parameters are supported', () => {
    render(<PresetsParameter onSelect={vi.fn()} supportedParameterNames={['max_tokens']} />)

    expect(
      screen.queryByRole('button', { name: /modelProvider\.modelProvider\.loadPresets/i }),
    ).not.toBeInTheDocument()
  })

  it('filters preset values to supported parameters', () => {
    expect(getSupportedPresetConfig(1, ['temperature'])).toEqual({
      temperature: 0.8,
    })
  })
})
