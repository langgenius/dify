/* eslint-disable ts/no-explicit-any */
import type { ScheduleTriggerNodeType } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FrequencySelector from '../frequency-selector'
import ModeToggle from '../mode-toggle'
import MonthlyDaysSelector from '../monthly-days-selector'
import NextExecutionTimes from '../next-execution-times'
import OnMinuteSelector from '../on-minute-selector'
import WeekdaySelector from '../weekday-selector'

const createData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  title: 'Schedule Trigger',
  desc: '',
  type: 'trigger-schedule' as ScheduleTriggerNodeType['type'],
  mode: 'visual',
  frequency: 'daily',
  timezone: 'UTC',
  visual_config: {
    time: '11:30 AM',
    weekdays: ['mon'],
    on_minute: 15,
    monthly_days: [1],
  },
  ...overrides,
})

describe('trigger-schedule components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The leaf controls should expose schedule actions and derived previews for the visual scheduler.
  describe('Leaf Rendering', () => {
    it('should select a new frequency from the dropdown options', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <FrequencySelector
          frequency="daily"
          onChange={onChange}
        />,
      )

      const trigger = screen.getByRole('combobox')
      await user.click(trigger)
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('weekly')
      })
    })

    it('should toggle the mode from visual to cron', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<ModeToggle mode="visual" onChange={onChange} />)

      await user.click(screen.getByRole('button'))

      expect(onChange).toHaveBeenCalledWith('cron')
    })

    it('should toggle the mode from cron back to visual', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<ModeToggle mode="cron" onChange={onChange} />)

      await user.click(screen.getByRole('button'))

      expect(onChange).toHaveBeenCalledWith('visual')
    })

    it('should change the hourly minute through the slider', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<OnMinuteSelector value={15} onChange={onChange} />)

      const slider = screen.getByLabelText('workflow.nodes.triggerSchedule.onMinute')
      slider.focus()
      await user.keyboard('{ArrowRight}')

      expect(onChange).toHaveBeenCalledWith(16, expect.objectContaining({ activeThumbIndex: 0 }))
    })

    it('should keep at least one weekday selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<WeekdaySelector selectedDays={['mon']} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'Mon' }))

      expect(onChange).toHaveBeenCalledWith(['mon'])
    })

    it('should add a new weekday when the day is not selected yet', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<WeekdaySelector selectedDays={[]} onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'Tue' }))

      expect(onChange).toHaveBeenCalledWith(['tue'])
    })

    it('should toggle monthly days and show the day-31 warning', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<MonthlyDaysSelector selectedDays={[31]} onChange={onChange} />)

      expect(screen.getByText('workflow.nodes.triggerSchedule.lastDayTooltip')).toBeInTheDocument()

      await user.click(screen.getByText('workflow.nodes.triggerSchedule.lastDay'))

      expect(onChange).toHaveBeenCalled()
    })

    it('should render the upcoming execution times when the schedule is valid', () => {
      render(<NextExecutionTimes data={createData()} />)

      expect(screen.getByText('workflow.nodes.triggerSchedule.nextExecutionTimes')).toBeInTheDocument()
      expect(screen.getAllByText(/^\d{2}$/).length).toBeGreaterThan(0)
    })

    it('should hide upcoming execution times when frequency is missing or cron is invalid', () => {
      const { rerender, container } = render(<NextExecutionTimes data={createData({ frequency: undefined }) as any} />)

      expect(container).toBeEmptyDOMElement()

      rerender(<NextExecutionTimes data={createData({ mode: 'cron', cron_expression: 'bad cron' }) as any} />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
