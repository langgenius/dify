import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import PresetsParameter from '../presets-parameter'

describe('PresetsParameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render presets and handle selection', () => {
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    expect(screen.getByText('common.modelProvider.loadPresets')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i }))
    fireEvent.click(screen.getByText('common.model.tone.Creative'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('should mark trigger as open when dropdown is expanded', () => {
    render(<PresetsParameter onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i }))

    const button = screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i })
    expect(button).toHaveAttribute('data-popup-open')
  })

  // Tone map branch 2: Balanced → Scales02 icon
  it('should call onSelect with tone id 2 when Balanced is clicked', () => {
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i }))
    fireEvent.click(screen.getByText('common.model.tone.Balanced'))

    expect(onSelect).toHaveBeenCalledWith(2)
  })

  // Tone map branch 3: Precise → Target04 icon
  it('should call onSelect with tone id 3 when Precise is clicked', () => {
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /common\.modelProvider\.loadPresets/i }))
    fireEvent.click(screen.getByText('common.model.tone.Precise'))

    expect(onSelect).toHaveBeenCalledWith(3)
  })
})
