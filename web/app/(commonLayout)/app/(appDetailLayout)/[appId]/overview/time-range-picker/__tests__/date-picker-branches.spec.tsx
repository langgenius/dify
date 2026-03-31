import type { Dayjs } from 'dayjs'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import DatePicker from '../date-picker'

const pickerState = vi.hoisted(() => ({
  disabledChecks: {} as Record<string, boolean>,
  startValue: undefined as Dayjs | undefined,
}))

vi.mock('@/app/components/base/date-and-time-picker/date-picker', () => ({
  default: ({
    value,
    renderTrigger,
    getIsDateDisabled,
  }: {
    value?: Dayjs
    renderTrigger: (props: {
      value?: Dayjs
      handleClickTrigger: () => void
      isOpen: boolean
    }) => ReactNode
    getIsDateDisabled: (date: Dayjs) => boolean
  }) => {
    const id = Object.keys(pickerState.disabledChecks).length === 0 ? 'start' : 'end'
    const triggerValue = id === 'start' ? undefined : value
    if (id === 'start')
      pickerState.startValue = value
    const trigger = renderTrigger({
      value: triggerValue,
      handleClickTrigger: () => {},
      isOpen: false,
    })

    pickerState.disabledChecks[id] = id === 'start'
      ? getIsDateDisabled(dayjs().add(1, 'day'))
      : getIsDateDisabled(dayjs(pickerState.startValue).add(30, 'day'))

    return (
      <div>
        <div data-testid={`${id}-trigger`}>{trigger}</div>
      </div>
    )
  },
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/utils/format', async () => {
  const actual = await vi.importActual<typeof import('@/utils/format')>('@/utils/format')
  return {
    ...actual,
    formatToLocalTime: (value: Dayjs, _locale: string, format: string) => value.format(format),
  }
})

describe('OverviewRouteDatePickerFallbackBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pickerState.disabledChecks = {}
    pickerState.startValue = undefined
  })

  it('should render an empty trigger for missing values and allow the 30-day end boundary', () => {
    const start = dayjs('2026-01-01')
    const end = dayjs('2026-01-10')

    render(<DatePicker start={start} end={end} onStartChange={vi.fn()} onEndChange={vi.fn()} />)

    expect(screen.getByTestId('start-trigger')).toHaveTextContent(/^$/)
    expect(screen.getByTestId('end-trigger')).toHaveTextContent('Jan 10')
    expect(pickerState.disabledChecks.start).toBe(true)
    expect(pickerState.disabledChecks.end).toBe(false)
  })
})
