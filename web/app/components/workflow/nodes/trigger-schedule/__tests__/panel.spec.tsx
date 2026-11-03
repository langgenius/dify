import type { ScheduleTriggerNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'

// Execution previews own their scheduling service; this suite edits the persisted schedule.
vi.mock('../components/next-execution-times', () => ({ default: () => null }))

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

const renderPanel = (data = createData(), readOnly = false) =>
  renderNodePanel(Panel, data, {
    initialStoreState: { canvasReadOnly: readOnly },
  })
const cronButton = () =>
  screen.getByRole('button', {
    name: 'workflowIntegrations.nodes.triggerSchedule.useCronExpression',
  })
const frequencyPicker = () => screen.getByRole('combobox', { name: /frequencyLabel/ })

describe('TriggerSchedulePanel', () => {
  it('prevents time editing when the workflow is read only', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData(), true)
    const trigger = screen.getByRole('button', { name: /11:30 AM.*UTC/ })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(data()).toMatchObject(createData())
  })

  it('saves frequency and time before switching to cron mode', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    await user.click(frequencyPicker())
    await user.click(
      screen.getByRole('option', {
        name: 'workflowIntegrations.nodes.triggerSchedule.frequency.weekly',
      }),
    )
    await user.click(screen.getByText('workflow.nodes.triggerSchedule.time', { exact: true }))
    const trigger = screen.getByRole('button', { name: /11:30 AM.*UTC/ })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('option', { name: '2' }))
    await user.click(screen.getByText('45'))
    await user.click(screen.getByText('PM'))
    await user.click(screen.getByRole('button', { name: /operation\.ok/i }))
    expect(data()).toMatchObject({
      frequency: 'weekly',
      visual_config: { time: '2:45 PM' },
      timezone: 'UTC',
    })
    expect(screen.getByRole('button', { name: /2:45 PM.*UTC/ })).toBeInTheDocument()
    await user.click(cronButton())
    expect(data().mode).toBe('cron')
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.triggerSchedule.cronExpression' }),
    ).toBeInTheDocument()
  })

  it('updates weekly and monthly selections while preserving other schedule settings', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData({ frequency: 'weekly' }))
    await user.click(screen.getByRole('button', { name: 'Wed' }))
    expect(data().visual_config?.weekdays).toEqual(['mon', 'wed'])
    await user.click(frequencyPicker())
    await user.click(
      screen.getByRole('option', {
        name: 'workflowIntegrations.nodes.triggerSchedule.frequency.monthly',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'workflowIntegrations.nodes.triggerSchedule.lastDay',
        pressed: false,
      }),
    )
    expect(data()).toMatchObject({
      frequency: 'monthly',
      timezone: 'UTC',
      visual_config: { monthly_days: [1, 'last'], time: '11:30 AM' },
    })
  })

  it('saves an edited cron expression', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(
      createData({ mode: 'cron', frequency: undefined, cron_expression: '0 0 * * *' }),
    )
    const input = screen.getByRole('textbox', {
      name: 'workflow.nodes.triggerSchedule.cronExpression',
    })
    await user.clear(input)
    await user.type(input, '*/5 * * * *')
    expect(data().cron_expression).toBe('*/5 * * * *')
    expect(input).toHaveValue('*/5 * * * *')
  })

  it('uses daily and empty cron defaults when schedule values are missing', async () => {
    const user = userEvent.setup()
    renderPanel(createData({ frequency: undefined }))
    expect(frequencyPicker()).toHaveTextContent(
      'workflowIntegrations.nodes.triggerSchedule.frequency.daily',
    )
    expect(screen.getByRole('button', { name: /11:30 AM/ })).toBeInTheDocument()
    await user.click(cronButton())
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.triggerSchedule.cronExpression' }),
    ).toHaveValue('')
  })

  it('saves the hourly minute selected with the slider', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData({ frequency: 'hourly' }))
    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowRight}')
    expect(data().visual_config?.on_minute).toBe(16)
  })

  it.each(['weekly', 'monthly', 'hourly'] as const)(
    'disables schedule editing in read-only %s mode',
    async (frequency) => {
      const user = userEvent.setup()
      const initial = createData({ frequency })
      const { data } = renderPanel(initial, true)
      expect(cronButton()).toBeDisabled()
      await user.click(cronButton())
      expect(frequencyPicker()).toBeDisabled()
      if (frequency !== 'hourly') {
        const day = screen.getByRole('button', { name: frequency === 'weekly' ? 'Wed' : '2' })
        expect(day).toBeDisabled()
        await user.click(day)
      } else expect(screen.getByRole('slider')).toBeDisabled()
      expect(data()).toMatchObject(initial)
    },
  )

  it('keeps cron expressions read-only when editing is denied', async () => {
    const user = userEvent.setup()
    const initial = createData({ mode: 'cron', cron_expression: '0 0 * * *' })
    const { data } = renderPanel(initial, true)
    const input = screen.getByRole('textbox', {
      name: 'workflow.nodes.triggerSchedule.cronExpression',
    })
    await user.type(input, '5')
    expect(input).toHaveValue('0 0 * * *')
    expect(data()).toMatchObject(initial)
  })
})
