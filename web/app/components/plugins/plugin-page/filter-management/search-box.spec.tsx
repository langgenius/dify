import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('SearchBox', () => {
  let SearchBox: (typeof import('./search-box'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./search-box')
    SearchBox = mod.default
  })

  it('should render input with placeholder', () => {
    render(<SearchBox searchQuery="" onChange={vi.fn()} />)

    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'search')
  })

  it('should display current search query', () => {
    render(<SearchBox searchQuery="test query" onChange={vi.fn()} />)

    expect(screen.getByRole('textbox')).toHaveValue('test query')
  })

  it('should call onChange when input changes', () => {
    const mockOnChange = vi.fn()
    render(<SearchBox searchQuery="" onChange={mockOnChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new query' } })
    expect(mockOnChange).toHaveBeenCalledWith('new query')
  })
})
