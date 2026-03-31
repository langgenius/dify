import type { Dayjs } from 'dayjs'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import DatePicker from '../date-picker'

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

const renderComponent = (overrides: Partial<React.ComponentProps<typeof DatePicker>> = {}) => {
  const props: React.ComponentProps<typeof DatePicker> = {
    start: dayjs().subtract(1, 'day'),
    end: dayjs(),
    onStartChange: vi.fn(),
    onEndChange: vi.fn(),
    ...overrides,
  }

  render(<DatePicker {...props} />)

  return props
}

describe('OverviewRouteDatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render formatted start and end triggers', () => {
      const start = dayjs('2026-01-10')
      const end = dayjs('2026-01-15')

      renderComponent({ start, end })

      expect(screen.getByText('Jan 10')).toBeInTheDocument()
      expect(screen.getByText('Jan 15')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open the start picker and notify when a new start date is selected', () => {
      const onStartChange = vi.fn()
      const end = dayjs()

      renderComponent({
        start: end.subtract(1, 'day'),
        end,
        onStartChange,
      })

      fireEvent.click(screen.getByText(end.subtract(1, 'day').format('MMM D')))
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('button', { name: `${end.date()}` }))

      expect(onStartChange).toHaveBeenCalledTimes(1)
      expect(dayjs(onStartChange.mock.calls[0][0]).isSame(end, 'date')).toBe(true)
    })

    it('should open the end picker and notify when a new end date is selected', () => {
      const onEndChange = vi.fn()
      const start = dayjs().subtract(1, 'day')

      renderComponent({
        start,
        end: dayjs(),
        onEndChange,
      })

      fireEvent.click(screen.getByText(dayjs().format('MMM D')))
      expect(screen.getAllByText(/daysInWeek/).length).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('button', { name: `${start.date()}` }))

      expect(onEndChange).toHaveBeenCalledTimes(1)
      expect(dayjs(onEndChange.mock.calls[0][0]).isSame(start, 'date')).toBe(true)
    })
  })
})
