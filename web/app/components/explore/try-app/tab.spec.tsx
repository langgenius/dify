import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Tab, { TypeEnum } from './tab'

// Ensure Try tab is rendered in tests, preserve other config exports
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'tryApp.tabHeader.try': 'Try',
        'tryApp.tabHeader.detail': 'Detail',
      }
      return translations[key] || key
    },
  }),
}))

describe('Tab', () => {
  let mockOnChange: (v: TypeEnum) => void

  beforeEach(() => {
    mockOnChange = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders tab with TRY value selected', async () => {
    render(<Tab value={TypeEnum.TRY} onChange={mockOnChange} />)

    expect(screen.getByText('Try')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
  })

  it('renders tab with DETAIL value selected', async () => {
    render(<Tab value={TypeEnum.DETAIL} onChange={mockOnChange} />)

    expect(screen.getByText('Try')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
  })

  it('calls onChange when clicking a tab', () => {
    render(<Tab value={TypeEnum.TRY} onChange={mockOnChange} />)

    fireEvent.click(screen.getByText('Detail'))
    expect(mockOnChange).toHaveBeenCalledWith(TypeEnum.DETAIL)
  })

  it('calls onChange when clicking Try tab', async () => {
    render(<Tab value={TypeEnum.DETAIL} onChange={mockOnChange} />)

    fireEvent.click(screen.getByText('Try'))
    expect(mockOnChange).toHaveBeenCalledWith(TypeEnum.TRY)
  })

  it('exports TypeEnum correctly', () => {
    expect(TypeEnum.TRY).toBe('try')
    expect(TypeEnum.DETAIL).toBe('detail')
  })
})
