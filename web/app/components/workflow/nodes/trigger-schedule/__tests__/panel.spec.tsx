/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { ScheduleTriggerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Panel from '../panel'
import useConfig from '../use-config'

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => (
    <div>
      <div>{title}</div>
      <div>{operations}</div>
      <div>{children}</div>
    </div>
  ),
}))

vi.mock('../components/frequency-selector', () => ({
  default: ({ frequency, onChange }: any) => (
    <button type="button" onClick={() => onChange('weekly')}>
      {frequency}
    </button>
  ),
}))

vi.mock('../components/mode-toggle', () => ({
  default: ({ mode, onChange }: any) => (
    <button type="button" onClick={() => onChange(mode === 'visual' ? 'cron' : 'visual')}>
      {mode}
    </button>
  ),
}))

vi.mock('../components/monthly-days-selector', () => ({
  default: ({ onChange }: any) => (
    <button type="button" onClick={() => onChange([1, 'last'])}>
      monthly-days
    </button>
  ),
}))

vi.mock('../components/next-execution-times', () => ({
  default: ({ data }: any) => <div>next-times-{data.mode}</div>,
}))

vi.mock('../components/on-minute-selector', () => ({
  default: ({ onChange }: any) => (
    <button type="button" onClick={() => onChange(25)}>
      minute-selector
    </button>
  ),
}))

vi.mock('../components/weekday-selector', () => ({
  default: ({ onChange }: any) => (
    <button type="button" onClick={() => onChange(['mon', 'wed'])}>
      weekday-selector
    </button>
  ),
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

const renderPanel = (id: string, data: ScheduleTriggerNodeType) => (
  render(<Panel id={id} data={data} panelProps={panelProps} />)
)

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
    it('should render the visual controls and forward their callbacks', async () => {
      const user = userEvent.setup()
      renderPanel('node-1', createData())

      await user.click(screen.getByRole('button', { name: 'visual' }))
      await user.click(screen.getByRole('button', { name: 'daily' }))
      await user.click(screen.getByDisplayValue('11:30 AM'))
      await user.click(screen.getAllByText('02')[0]!)
      await user.click(screen.getByText('45'))
      await user.click(screen.getByText('PM'))
      await user.click(screen.getByRole('button', { name: /operation\.ok/i }))

      expect(handleModeChange).toHaveBeenCalledWith('cron')
      expect(handleFrequencyChange).toHaveBeenCalledWith('weekly')
      expect(handleTimeChange).toHaveBeenCalledWith('2:45 PM')
      expect(screen.getByText('next-times-visual')).toBeInTheDocument()
    })

    it('should render weekday and monthly helpers for the matching frequencies', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValueOnce({
        readOnly: false,
        inputs: createData({ frequency: 'weekly' }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      renderPanel('node-1', createData({ frequency: 'weekly' }))
      await user.click(screen.getByRole('button', { name: 'weekday-selector' }))
      expect(handleWeekdaysChange).toHaveBeenCalledWith(['mon', 'wed'])

      mockUseConfig.mockReturnValueOnce({
        readOnly: false,
        inputs: createData({ frequency: 'weekly', visual_config: undefined as any }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      renderPanel('node-5', createData({ frequency: 'weekly', visual_config: undefined as any }))
      await user.click(screen.getAllByRole('button', { name: 'weekday-selector' })[1]!)
      expect(handleWeekdaysChange).toHaveBeenCalledTimes(2)

      mockUseConfig.mockReturnValueOnce({
        readOnly: false,
        inputs: createData({ frequency: 'monthly', visual_config: undefined as any }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      renderPanel('node-2', createData({ frequency: 'monthly', visual_config: undefined as any }))
      await user.click(screen.getByRole('button', { name: 'monthly-days' }))
      expect(setInputs).toHaveBeenCalled()
    })

    it('should render cron mode and forward expression changes', () => {
      mockUseConfig.mockReturnValueOnce({
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

      fireEvent.change(screen.getByDisplayValue('0 0 * * *'), { target: { value: '*/5 * * * *' } })

      expect(handleCronExpressionChange).toHaveBeenCalledWith('*/5 * * * *')
    })

    it('should use daily and empty cron defaults when the schedule values are missing', () => {
      mockUseConfig.mockReturnValueOnce({
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

      const { rerender } = renderPanel('node-6', createData({ frequency: undefined }) as any)
      expect(screen.getByRole('button', { name: 'daily' })).toBeInTheDocument()
      expect(screen.getByDisplayValue('11:30 AM')).toBeInTheDocument()

      mockUseConfig.mockReturnValueOnce({
        readOnly: false,
        inputs: createData({ mode: 'cron', frequency: undefined, cron_expression: undefined as any }),
        setInputs,
        handleModeChange,
        handleFrequencyChange,
        handleCronExpressionChange,
        handleWeekdaysChange,
        handleTimeChange,
        handleOnMinuteChange,
      })

      rerender(<Panel id="node-7" data={createData({ mode: 'cron', frequency: undefined, cron_expression: undefined as any }) as any} panelProps={panelProps} />)
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should render the hourly minute selector when the frequency is hourly', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValueOnce({
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
      await user.click(screen.getByRole('button', { name: 'minute-selector' }))

      expect(handleOnMinuteChange).toHaveBeenCalledWith(25)
    })
  })
})
