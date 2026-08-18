import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import PresetsParameter from '../presets-parameter'
import { getSupportedPresetConfig } from '../presets-parameter-utils'

describe('PresetsParameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects a preset', () => {
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i }))
    fireEvent.click(screen.getByText('common.model.tone.Creative'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('hides presets when none of their parameters are supported', () => {
    render(<PresetsParameter onSelect={vi.fn()} supportedParameterNames={['max_tokens']} />)

    expect(
      screen.queryByRole('button', { name: /common\.modelProvider\.loadPresets/i }),
    ).not.toBeInTheDocument()
  })

  it('filters preset values to supported parameters', () => {
    expect(getSupportedPresetConfig(1, ['temperature'])).toEqual({
      temperature: 0.8,
    })
  })
})
