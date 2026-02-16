import type { TimeOptionsProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
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

    it('should render 60 minute options by default', () => {
      const props = createOptionsProps()

      render(<Options {...props} />)

      const allItems = screen.getAllByRole('listitem')
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
    it('should call handleSelectHour when an hour is clicked', () => {
      const handleSelectHour = vi.fn()
      const props = createOptionsProps({ handleSelectHour })

      render(<Options {...props} />)
      const hourItems = screen.getAllByRole('listitem')
      fireEvent.click(hourItems[0])

      expect(handleSelectHour).toHaveBeenCalled()
    })

    it('should call handleSelectMinute when a minute is clicked', () => {
      const handleSelectMinute = vi.fn()
      const props = createOptionsProps({ handleSelectMinute })

      render(<Options {...props} />)
      const allItems = screen.getAllByRole('listitem')
      fireEvent.click(allItems[13])

      expect(handleSelectMinute).toHaveBeenCalled()
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
