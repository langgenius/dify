import type { TimeOptionsProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Options from './options'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const createOptionsProps = (overrides: Partial<TimeOptionsProps> = {}): TimeOptionsProps => ({
  selectedTime: undefined,
  handleSelectHour: vi.fn(),
  handleSelectMinute: vi.fn(),
  handleSelectPeriod: vi.fn(),
  ...overrides,
})

describe('TimePickerOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render hour options', () => {
      const props = createOptionsProps()

      render(<Options {...props} />)

      const allItems = screen.getAllByRole('listitem')
      expect(allItems.length).toBeGreaterThan(12)
    })

    it('should render all hour, minute, and period options by default', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)
      const allItems = screen.getAllByRole('listitem')
      // 12 hours + 60 minutes + 2 periods
      expect(allItems).toHaveLength(74)
    })

    it('should render AM and PM period options', () => {
      const props = createOptionsProps()

      render(<Options {...props} />)

      expect(screen.getByText('AM')).toBeInTheDocument()
      expect(screen.getByText('PM')).toBeInTheDocument()
    })
  })

  describe('Minute Filter', () => {
    it('should apply minuteFilter when provided', () => {
      const minuteFilter = (minutes: string[]) => minutes.filter(m => Number(m) % 15 === 0)
      const props = createOptionsProps({ minuteFilter })

      render(<Options {...props} />)

      const allItems = screen.getAllByRole('listitem')
      expect(allItems).toHaveLength(18)
    })
  })

  describe('Interactions', () => {
    it('should render selected hour in the list', () => {
      const props = createOptionsProps({ selectedTime: dayjs('2024-01-01 05:30:00') })
      render(<Options {...props} />)
      const selectedHour = screen.getAllByRole('listitem').find(item => item.textContent === '05')
      expect(selectedHour).toHaveClass('bg-components-button-ghost-bg-hover')
    })
    it('should render selected minute in the list', () => {
      const props = createOptionsProps({ selectedTime: dayjs('2024-01-01 05:30:00') })
      render(<Options {...props} />)
      const selectedMinute = screen.getAllByRole('listitem').find(item => item.textContent === '30')
      expect(selectedMinute).toHaveClass('bg-components-button-ghost-bg-hover')
    })

    it('should call handleSelectPeriod when AM is clicked', () => {
      const handleSelectPeriod = vi.fn()
      const props = createOptionsProps({ handleSelectPeriod })

      render(<Options {...props} />)
      fireEvent.click(screen.getAllByText('AM')[0])

      expect(handleSelectPeriod).toHaveBeenCalledWith('AM')
    })

    it('should call handleSelectPeriod when PM is clicked', () => {
      const handleSelectPeriod = vi.fn()
      const props = createOptionsProps({ handleSelectPeriod })

      render(<Options {...props} />)
      fireEvent.click(screen.getAllByText('PM')[0])

      expect(handleSelectPeriod).toHaveBeenCalledWith('PM')
    })
  })
})
