import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Tab, { TypeEnum } from '../tab'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal() as object
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

describe('Tab', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders tab with TRY value selected', () => {
    const mockOnChange = vi.fn()
    render(<Tab value={TypeEnum.TRY} onChange={mockOnChange} />)

    expect(screen.getByText('explore.tryApp.tabHeader.try')).toBeInTheDocument()
    expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
  })

  it('renders tab with DETAIL value selected', () => {
    const mockOnChange = vi.fn()
    render(<Tab value={TypeEnum.DETAIL} onChange={mockOnChange} />)

    expect(screen.getByText('explore.tryApp.tabHeader.try')).toBeInTheDocument()
    expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
  })

  it('calls onChange when clicking a tab', () => {
    const mockOnChange = vi.fn()
    render(<Tab value={TypeEnum.TRY} onChange={mockOnChange} />)

    fireEvent.click(screen.getByText('explore.tryApp.tabHeader.detail'))
    expect(mockOnChange).toHaveBeenCalledWith(TypeEnum.DETAIL)
  })

  it('calls onChange when clicking Try tab', () => {
    const mockOnChange = vi.fn()
    render(<Tab value={TypeEnum.DETAIL} onChange={mockOnChange} />)

    fireEvent.click(screen.getByText('explore.tryApp.tabHeader.try'))
    expect(mockOnChange).toHaveBeenCalledWith(TypeEnum.TRY)
  })

  it('exports TypeEnum correctly', () => {
    expect(TypeEnum.TRY).toBe('try')
    expect(TypeEnum.DETAIL).toBe('detail')
  })
})
