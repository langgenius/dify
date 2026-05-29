import type { ScheduleTriggerNodeType } from '../../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '../../../../types'
import NextExecutionTimes from '../next-execution-times'

const createData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  title: 'Schedule Trigger',
  desc: '',
  type: BlockEnum.TriggerSchedule,
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

describe('trigger-schedule/next-execution-times', () => {
  it('renders the upcoming execution times when the schedule is valid', () => {
    render(<NextExecutionTimes data={createData()} />)

    expect(screen.getByText('workflow.nodes.triggerSchedule.nextExecutionTimes')).toBeInTheDocument()
    expect(screen.getAllByText(/^\d{2}$/).length).toBeGreaterThan(0)
  })

  it('hides upcoming execution times when frequency is missing or cron is invalid', () => {
    const { rerender, container } = render(<NextExecutionTimes data={createData({ frequency: undefined })} />)

    expect(container).toBeEmptyDOMElement()

    rerender(<NextExecutionTimes data={createData({ mode: 'cron', cron_expression: 'bad cron' })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
