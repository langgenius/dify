import type { ScheduleTriggerNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useAppContext } from '@/context/app-context'
import { createAccountProfileQueryWrapper } from '@/test/account-profile-query'
import { BlockEnum } from '../../../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseAppContext = vi.mocked(useAppContext)

const setInputs = vi.fn()

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

describe('trigger-schedule/use-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseAppContext.mockReturnValue({
      userProfile: { timezone: 'Asia/Shanghai' },
    } as ReturnType<typeof useAppContext>)
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs,
    } as ReturnType<typeof useNodeCrud>)
  })

  it('hydrates defaults for missing mode, frequency, timezone, and visual config', () => {
    renderHook(() => useConfig('schedule-node', createData({
      mode: undefined as never,
      frequency: undefined,
      timezone: undefined,
      visual_config: undefined,
    })), { wrapper: createAccountProfileQueryWrapper() })

    expect(mockUseNodeCrud).toHaveBeenCalledWith('schedule-node', expect.objectContaining({
      mode: 'visual',
      frequency: 'daily',
      timezone: 'Asia/Shanghai',
      visual_config: expect.objectContaining({
        time: '12:00 AM',
        weekdays: ['sun'],
        on_minute: 0,
        monthly_days: [1],
      }),
    }))
  })

  it('updates visual mode configuration and clears cron expression when needed', () => {
    const { result } = renderHook(() => useConfig('schedule-node', createData({
      cron_expression: '0 0 * * *',
    })), { wrapper: createAccountProfileQueryWrapper() })

    result.current.handleModeChange('cron')
    result.current.handleFrequencyChange('hourly')
    result.current.handleWeekdaysChange(['tue', 'thu'])
    result.current.handleTimeChange('08:15 AM')
    result.current.handleOnMinuteChange(45)

    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cron' }))
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      frequency: 'hourly',
      cron_expression: undefined,
      visual_config: expect.objectContaining({ on_minute: 15 }),
    }))
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      visual_config: expect.objectContaining({ weekdays: ['tue', 'thu'] }),
      cron_expression: undefined,
    }))
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      visual_config: expect.objectContaining({ time: '08:15 AM' }),
      cron_expression: undefined,
    }))
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      visual_config: expect.objectContaining({ on_minute: 45 }),
      cron_expression: undefined,
    }))
  })

  it('keeps only fields used by the selected visual frequency', () => {
    mockUseNodeCrud.mockReturnValue({
      inputs: createData({
        visual_config: {
          time: '08:30 AM',
          weekdays: ['tue', 'thu'],
          on_minute: 20,
          monthly_days: [5, 'last'],
        },
      }),
      setInputs,
    } as ReturnType<typeof useNodeCrud>)

    const { result } = renderHook(() => useConfig('schedule-node', createData()))

    result.current.handleFrequencyChange('daily')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'daily',
      cron_expression: undefined,
      visual_config: {
        time: '08:30 AM',
      },
    }))

    result.current.handleFrequencyChange('weekly')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'weekly',
      cron_expression: undefined,
      visual_config: {
        time: '08:30 AM',
        weekdays: ['tue', 'thu'],
      },
    }))

    result.current.handleFrequencyChange('monthly')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'monthly',
      cron_expression: undefined,
      visual_config: {
        time: '08:30 AM',
        monthly_days: [5, 'last'],
      },
    }))

    result.current.handleFrequencyChange('hourly')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'hourly',
      cron_expression: undefined,
      visual_config: {
        on_minute: 20,
      },
    }))
  })

  it('uses default frequency-specific fields when switching from a cleaned visual config', () => {
    mockUseNodeCrud.mockReturnValue({
      inputs: createData({
        frequency: 'daily',
        visual_config: {
          time: '08:30 AM',
        },
      }),
      setInputs,
    } as ReturnType<typeof useNodeCrud>)

    const { result } = renderHook(() => useConfig('schedule-node', createData()))

    result.current.handleFrequencyChange('weekly')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'weekly',
      cron_expression: undefined,
      visual_config: {
        time: '08:30 AM',
        weekdays: ['sun'],
      },
    }))

    result.current.handleFrequencyChange('monthly')
    expect(setInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      frequency: 'monthly',
      cron_expression: undefined,
      visual_config: {
        time: '08:30 AM',
        monthly_days: [1],
      },
    }))
  })

  it('switches to raw cron mode and clears visual schedule fields', () => {
    const { result } = renderHook(() => useConfig('schedule-node', createData()), { wrapper: createAccountProfileQueryWrapper() })

    result.current.handleCronExpressionChange('*/15 * * * *')

    expect(result.current.readOnly).toBe(false)
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      cron_expression: '*/15 * * * *',
      frequency: undefined,
      visual_config: undefined,
    }))
  })
})
