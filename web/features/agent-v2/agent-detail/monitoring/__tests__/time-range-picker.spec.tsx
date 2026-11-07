import type { Dayjs } from 'dayjs'
import type { AgentMonitoringPeriod } from '../time-range'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { AgentMonitoringTimeRangePicker } from '../time-range-picker'

const rangePicker = vi.hoisted(() => ({
  start: null as unknown as Dayjs,
  end: null as unknown as Dayjs,
  onStartChange: (() => {}) as (date: Dayjs) => void,
  onEndChange: (() => {}) as (date: Dayjs) => void,
}))

vi.mock('@/app/components/app/monitoring/date-range-picker', () => ({
  MonitoringDateRangePicker: (props: {
    start: Dayjs
    end: Dayjs
    onStartChange: (date: Dayjs) => void
    onEndChange: (date: Dayjs) => void
  }) => {
    rangePicker.start = props.start
    rangePicker.end = props.end
    rangePicker.onStartChange = props.onStartChange
    rangePicker.onEndChange = props.onEndChange

    return <div data-testid="range-picker" />
  },
}))

const period: AgentMonitoringPeriod = {
  name: 'Nov 6 - Nov 7',
  query: { start: '2026-11-06 00:00', end: '2026-11-08 00:00' },
}

const renderPicker = (onChange: (next: AgentMonitoringPeriod) => void) =>
  render(<AgentMonitoringTimeRangePicker value={period} onChange={onChange} />)

describe('AgentMonitoringTimeRangePicker', () => {
  it('should show the selected end date, not the exclusive bound', () => {
    renderPicker(vi.fn())

    expect(rangePicker.start.format('YYYY-MM-DD')).toBe('2026-11-06')
    expect(rangePicker.end.format('YYYY-MM-DD')).toBe('2026-11-07')
  })

  it('should end a preset range at the midnight after today', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderPicker(onChange)

    await user.click(screen.getByRole('combobox', { name: /timeRangeLabel/ }))
    await user.click(
      await screen.findByRole('option', {
        name: /agentDetail\.monitoring\.timeRanges\.last7days/,
      }),
    )

    const today = dayjs().startOf('day')
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'agentV2.agentDetail.monitoring.timeRanges.last7days',
      query: {
        start: today.subtract(7, 'day').format('YYYY-MM-DD HH:mm'),
        end: today.add(1, 'day').format('YYYY-MM-DD HH:mm'),
      },
    })
  })

  it('should end a custom range at the midnight after the picked end date', () => {
    const onChange = vi.fn()
    renderPicker(onChange)

    act(() => rangePicker.onEndChange(dayjs('2026-11-05')))

    expect(onChange).toHaveBeenLastCalledWith({
      name: 'Nov 6 - Nov 5',
      query: { start: '2026-11-06 00:00', end: '2026-11-06 00:00' },
    })
  })

  it('should keep the picked start date and ignore a repeated selection', () => {
    const onChange = vi.fn()
    renderPicker(onChange)

    act(() => rangePicker.onStartChange(dayjs('2026-11-06')))
    expect(onChange).not.toHaveBeenCalled()

    act(() => rangePicker.onStartChange(dayjs('2026-11-04')))
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'Nov 4 - Nov 7',
      query: { start: '2026-11-04 00:00', end: '2026-11-08 00:00' },
    })
  })
})
