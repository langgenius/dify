import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import ToolDateRangePicker from '../tool-date-range-picker'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'time.dateFormats.display': 'MMMM D, YYYY',
      'time.defaultPlaceholder': 'Select date',
      'common.operation.clear': 'Clear',
      'workflow.nodes.tool.dateRange.start': 'Start',
      'workflow.nodes.tool.dateRange.end': 'End',
      'workflow.nodes.tool.dateRange.startPlaceholder': 'Start date',
      'workflow.nodes.tool.dateRange.endPlaceholder': 'End date',
    }),
  }
})

describe('ToolDateRangePicker', () => {
  it('preserves stored date-only values when rendering in a negative timezone', () => {
    render(
      <ToolDateRangePicker
        value={JSON.stringify({ start: '2024-05-01', end: '2024-05-03' })}
        onChange={vi.fn()}
        timezone="America/Los_Angeles"
      />,
    )

    expect(screen.getByRole('button', { name: 'Start date: May 1, 2024' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End date: May 3, 2024' })).toBeInTheDocument()
  })

  it('clears one boundary without changing the other', () => {
    const onChange = vi.fn()
    render(
      <ToolDateRangePicker
        value={JSON.stringify({ start: '2024-05-01', end: '2024-05-03' })}
        onChange={onChange}
        timezone="UTC"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start date: Clear' }))

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ end: '2024-05-03' }))
  })

  it('returns an empty value when clearing the last boundary', () => {
    const onChange = vi.fn()
    render(
      <ToolDateRangePicker
        value={JSON.stringify({ start: '2024-05-01' })}
        onChange={onChange}
        timezone="UTC"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start date: Clear' }))

    expect(onChange).toHaveBeenCalledWith('')
  })
})
