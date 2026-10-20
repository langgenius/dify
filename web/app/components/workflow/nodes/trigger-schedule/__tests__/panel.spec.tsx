import type { ScheduleTriggerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Panel from '../panel'
import useConfig from '../use-config'

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

vi.mock('../components/next-execution-times', () => ({
  default: () => null,
}))

const mockUseConfig = vi.mocked(useConfig)

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

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

const renderPanel = (id: string, data: ScheduleTriggerNodeType) =>
  render(<Panel id={id} data={data} panelProps={panelProps} />)

describe('TriggerSchedulePanel', () => {
  const setInputs = vi.fn()
  const handleModeChange = vi.fn()
  const handleFrequencyChange = vi.fn()
  const handleCronExpressionChange = vi.fn()
  const handleWeekdaysChange = vi.fn()
  const handleTimeChange = vi.fn()
  const handleOnMinuteChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      setInputs,
      handleModeChange,
      handleFrequencyChange,
      handleCronExpressionChange,
      handleWeekdaysChange,
      handleTimeChange,
      handleOnMinuteChange,
    })
  })

  // The panel should wire the visual and cron controls back to the schedule config handlers.
  describe('Panel Wiring', () => {
    it('prevents time editing when the workflow is read only', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue({ ...mockUseConfig('node-1', createData()), readOnly: true })
      renderPanel('node-1', createData())
      const trigger = screen.getByRole('button', { name: /11:30 AM.*UTC/ })
      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(handleTimeChange).not.toHaveBeenCalled()
    })
    it('should render the visual controls and forward their callbacks', async () => {
      const user = userEvent.setup()
      renderPanel('node-1', createData())

      await user.click(
        screen.getByRole('button', {
          name: 'workflowIntegrations.nodes.triggerSchedule.useCronExpression',
        }),
      )
      await user.click(screen.getByRole('combobox', { name: /frequencyLabel/ }))
      await user.click(
        screen.getByRole('option', {
          name: 'workflowIntegrations.nodes.triggerSchedule.frequency.weekly',
        }),
      )
      await user.click(screen.getByText('workflow.nodes.triggerSchedule.time', { exact: true }))
      const timeTrigger = screen.getByRole('button', { name: /11:30 AM.*UTC/ })
      expect(timeTrigger).toHaveFocus()
      expect(timeTrigger).toHaveAttribute('aria-expanded', 'false')
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('option', { name: '2' }))
      await user.click(screen.getByText('45'))
      await user.click(screen.getByText('PM'))
      await user.click(screen.getByRole('button', { name: /operation\.ok/i }))

      expect(handleModeChange).toHaveBeenCalledWith('cron')
      expect(handleFrequencyChange).toHaveBeenCalledWith('weekly')
      expect(handleTimeChange).toHaveBeenCalledWith('2:45 PM')
    })

    it('updates weekly and monthly selections while preserving other schedule settings', async () => {
      const user = userEvent.setup()
      const config = mockUseConfig('node-1', createData())
      mockUseConfig.mockReturnValue({ ...config, inputs: createData({ frequency: 'weekly' }) })
      const { rerender } = renderPanel('node-1', createData())
      await user.click(screen.getByRole('button', { name: 'Wed' }))
      expect(handleWeekdaysChange).toHaveBeenCalledWith(['mon', 'wed'])
      const monthly = createData({ frequency: 'monthly' })
      mockUseConfig.mockReturnValue({ ...config, inputs: monthly })
      rerender(<Panel id="node-1" data={monthly} panelProps={panelProps} />)
      await user.click(
        screen.getByRole('button', {
          name: 'workflowIntegrations.nodes.triggerSchedule.lastDay',
          pressed: false,
        }),
      )
      expect(setInputs).toHaveBeenCalledWith({
        ...monthly,
        visual_config: { ...monthly.visual_config, monthly_days: [1, 'last'] },
      })
    })

    it('should render cron mode and forward expression changes', () => {
      mockUseConfig.mockReturnValue({
        readOnly: false,
        inputs: createData({ mode: 'cron', frequency: undefined, cron_expression: '0 0 * * *' }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      renderPanel('node-3', createData({ mode: 'cron' }))

      fireEvent.change(
        screen.getByRole('textbox', {
          name: 'workflow.nodes.triggerSchedule.cronExpression',
        }),
        { target: { value: '*/5 * * * *' } },
      )

      expect(handleCronExpressionChange).toHaveBeenCalledWith('*/5 * * * *')
    })

    it('should use daily and empty cron defaults when the schedule values are missing', () => {
      mockUseConfig.mockReturnValue({
        readOnly: false,
        inputs: createData({ frequency: undefined }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      const { rerender } = renderPanel('node-6', createData({ frequency: undefined }))
      expect(screen.getByRole('combobox', { name: /frequencyLabel/ })).toHaveTextContent(
        'workflowIntegrations.nodes.triggerSchedule.frequency.daily',
      )
      expect(screen.getByRole('button', { name: /11:30 AM/ })).toBeInTheDocument()

      mockUseConfig.mockReturnValue({
        readOnly: false,
        inputs: createData({
          mode: 'cron',
          frequency: undefined,
          cron_expression: undefined as any,
        }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      rerender(
        <Panel
          id="node-7"
          data={createData({
            mode: 'cron',
            frequency: undefined,
            cron_expression: undefined as any,
          })}
          panelProps={panelProps}
        />,
      )
      expect(
        screen.getByRole('textbox', {
          name: 'workflow.nodes.triggerSchedule.cronExpression',
        }),
      ).toHaveValue('')
    })

    it('should render the hourly minute selector when the frequency is hourly', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue({
        readOnly: false,
        inputs: createData({ frequency: 'hourly' }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      renderPanel('node-4', createData({ frequency: 'hourly' }))
      screen.getByRole('slider').focus()
      await user.keyboard('{ArrowRight}')
      expect(handleOnMinuteChange).toHaveBeenCalledWith(16, expect.anything())
    })
  })
  it.each(['weekly', 'monthly', 'hourly'] as const)(
    'disables schedule editing in read-only %s mode',
    async (frequency) => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue({
        ...mockUseConfig('node-1', createData()),
        inputs: createData({ frequency }),
        readOnly: true,
      })
      renderPanel('node-1', createData())
      const mode = screen.getByRole('button', {
        name: 'workflowIntegrations.nodes.triggerSchedule.useCronExpression',
      })
      expect(mode).toBeDisabled()
      await user.click(mode)
      expect(screen.getByRole('combobox', { name: /frequencyLabel/ })).toBeDisabled()
      if (frequency === 'weekly') {
        expect(screen.getByRole('button', { name: 'Wed' })).toBeDisabled()
        await user.click(screen.getByRole('button', { name: 'Wed' }))
      }
      if (frequency === 'monthly') {
        expect(screen.getByRole('button', { name: '2' })).toBeDisabled()
        await user.click(screen.getByRole('button', { name: '2' }))
      }
      if (frequency === 'hourly') expect(screen.getByRole('slider')).toBeDisabled()
      expect(handleModeChange).not.toHaveBeenCalled()
      expect(handleWeekdaysChange).not.toHaveBeenCalled()
      expect(setInputs).not.toHaveBeenCalled()
    },
  )

  it('keeps cron expressions read-only when editing is denied', async () => {
    const user = userEvent.setup()
    mockUseConfig.mockReturnValue({
      ...mockUseConfig('node-1', createData()),
      inputs: createData({ mode: 'cron', cron_expression: '0 0 * * *' }),
      readOnly: true,
    })
    renderPanel('node-1', createData())
    const input = screen.getByRole('textbox', {
      name: 'workflow.nodes.triggerSchedule.cronExpression',
    })
    await user.type(input, '5')
    expect(input).toHaveValue('0 0 * * *')
    expect(handleCronExpressionChange).not.toHaveBeenCalled()
  })
})
