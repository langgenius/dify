import { useCallback, useMemo } from 'react'
import type { ScheduleFrequency, ScheduleMode, ScheduleTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { convertTimeToUTC, convertUTCToUserTimezone } from './utils/timezone-utils'

const useConfig = (id: string, payload: ScheduleTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const frontendPayload = useMemo(() => {
    const basePayload = {
      ...payload,
      mode: payload.mode || 'visual',
      frequency: payload.frequency || 'weekly',
      timezone: payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: payload.enabled !== undefined ? payload.enabled : true,
    }

    if (payload.visual_config?.time && payload.timezone) {
      const userTime = convertUTCToUserTimezone(payload.visual_config.time, payload.timezone)
      return {
        ...basePayload,
        visual_config: {
          ...payload.visual_config,
          time: userTime,
        },
      }
    }

    return {
      ...basePayload,
      visual_config: {
        time: '11:30 AM',
        weekdays: ['sun'],
        ...payload.visual_config,
      },
    }
  }, [payload])

  const { inputs, setInputs } = useNodeCrud<ScheduleTriggerNodeType>(id, frontendPayload, {
    beforeSave: (data) => {
      if (data.visual_config?.time && data.timezone) {
        const utcTime = convertTimeToUTC(data.visual_config.time, data.timezone)
        return {
          ...data,
          visual_config: {
            ...data.visual_config,
            time: utcTime,
          },
        }
      }
      return data
    },
  })

  const handleModeChange = useCallback((mode: ScheduleMode) => {
    const newInputs = {
      ...inputs,
      mode,
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleFrequencyChange = useCallback((frequency: ScheduleFrequency) => {
    const newInputs = {
      ...inputs,
      frequency,
      visual_config: {
        ...inputs.visual_config,
        ...(frequency === 'hourly') && {
          on_minute: inputs.visual_config?.on_minute ?? 0,
        },
      },
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCronExpressionChange = useCallback((value: string) => {
    const newInputs = {
      ...inputs,
      cron_expression: value,
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleWeekdaysChange = useCallback((weekdays: string[]) => {
    const newInputs = {
      ...inputs,
      visual_config: {
        ...inputs.visual_config,
        weekdays,
      },
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleTimeChange = useCallback((time: string) => {
    const newInputs = {
      ...inputs,
      visual_config: {
        ...inputs.visual_config,
        time,
      },
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleOnMinuteChange = useCallback((on_minute: number) => {
    const newInputs = {
      ...inputs,
      visual_config: {
        ...inputs.visual_config,
        on_minute,
      },
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    setInputs,
    handleModeChange,
    handleFrequencyChange,
    handleCronExpressionChange,
    handleWeekdaysChange,
    handleTimeChange,
    handleOnMinuteChange,
  }
}

export default useConfig
