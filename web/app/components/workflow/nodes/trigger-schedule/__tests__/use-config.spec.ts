import type { ScheduleTriggerNodeType } from '../types'
import { act } from '@testing-library/react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { BlockEnum } from '../../../types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

const createData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  title: 'Schedule Trigger',
  desc: '',
  type: BlockEnum.TriggerSchedule,
  mode: 'visual',
  frequency: 'daily',
  timezone: 'UTC',
  visual_config: { time: '11:30 AM', weekdays: ['mon'], on_minute: 15, monthly_days: [1] },
  ...overrides,
})

it('derives missing schedule defaults from the account timezone', () => {
  const { queryClient } = createConsoleQueryWrapper()
  seedAccountProfileQuery(queryClient, { timezone: 'Asia/Shanghai' })
  const { result } = renderNodeConfig(
    useConfig,
    createData({
      mode: undefined as never,
      frequency: undefined,
      timezone: undefined,
      visual_config: undefined,
    }),
    { queryClient },
  )
  expect(result.current.config.inputs).toEqual(
    expect.objectContaining({
      mode: 'visual',
      frequency: 'daily',
      timezone: 'Asia/Shanghai',
      visual_config: { time: '12:00 AM', weekdays: ['sun'], on_minute: 0, monthly_days: [1] },
    }),
  )
})

it('persists consecutive schedule edits and clears the stale cron expression', () => {
  const { result } = renderNodeConfig(useConfig, createData({ cron_expression: '0 0 * * *' }))
  act(() => result.current.config.handleModeChange('visual'))
  act(() => result.current.config.handleFrequencyChange('hourly'))
  act(() => result.current.config.handleWeekdaysChange(['tue', 'thu']))
  act(() => result.current.config.handleTimeChange('08:15 AM'))
  act(() => result.current.config.handleOnMinuteChange(45))
  expect(result.current.flow.getNode('node')?.data).toEqual(
    expect.objectContaining({
      mode: 'visual',
      frequency: 'hourly',
      cron_expression: undefined,
      visual_config: {
        time: '08:15 AM',
        weekdays: ['tue', 'thu'],
        on_minute: 45,
        monthly_days: [1],
      },
    }),
  )
})

it('persists raw cron mode without visual schedule fields', () => {
  const { result } = renderNodeConfig(useConfig, createData())
  act(() => result.current.config.handleModeChange('cron'))
  act(() => result.current.config.handleCronExpressionChange('*/15 * * * *'))
  expect(result.current.flow.getNode('node')?.data).toEqual(
    expect.objectContaining({
      mode: 'cron',
      cron_expression: '*/15 * * * *',
      frequency: undefined,
      visual_config: undefined,
    }),
  )
})
