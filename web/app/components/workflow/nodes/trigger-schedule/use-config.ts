import { useCallback, useMemo } from 'react'
import type { ScheduleFrequency, ScheduleMode, ScheduleTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useAppContext } from '@/context/app-context'
import { createTimezoneConverterFromUserProfile } from './utils/timezone-converter'
import { getDefaultVisualConfig } from './default'

const useConfig = (id: string, payload: ScheduleTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { userProfile } = useAppContext()

  // Use unified timezone converter
  const converter = useMemo(() =>
    createTimezoneConverterFromUserProfile(userProfile, payload.timezone),
    [userProfile, payload.timezone],
  )

  const frontendPayload = useMemo(() => {
    const basePayload = {
      ...payload,
      mode: payload.mode || 'visual',
      frequency: payload.frequency || 'weekly',
      timezone: converter.getUserTimezone(),
      enabled: payload.enabled !== undefined ? payload.enabled : true,
    }

    // Only convert time from UTC to user timezone format when needed
    const needsConversion = payload.visual_config?.time
                          && converter.isUTCFormat(payload.visual_config.time)

    if (needsConversion && payload.visual_config) {
      const userTime = converter.fromUTC(payload.visual_config.time!)
      return {
        ...basePayload,
        visual_config: {
          ...payload.visual_config,
          time: userTime,
        },
      }
    }

    // Use default values or existing user format directly
    return {
      ...basePayload,
      visual_config: {
        ...getDefaultVisualConfig(),
        ...payload.visual_config,
      },
    }
  }, [payload, converter])

  const { inputs, setInputs: originalSetInputs } = useNodeCrud<ScheduleTriggerNodeType>(id, frontendPayload)

  // Enhanced setInputs with beforeSave logic using unified converter
  const setInputs = useCallback((data: ScheduleTriggerNodeType) => {
    // Only convert user time format to UTC to avoid duplicate conversions
    if (data.visual_config?.time && converter.isUserFormat(data.visual_config.time)) {
      const utcTime = converter.toUTC(data.visual_config.time)
      const transformedData = {
        ...data,
        visual_config: {
          ...data.visual_config,
          time: utcTime,
        },
      }
      originalSetInputs(transformedData)
    }
    else {
      originalSetInputs(data)
    }
  }, [originalSetInputs, converter])

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
          on_minute: inputs.visual_config?.on_minute ?? getDefaultVisualConfig().on_minute,
        },
        ...(frequency === 'weekly') && {
          weekdays: inputs.visual_config?.weekdays || getDefaultVisualConfig().weekdays,
        },
        ...(frequency === 'monthly') && {
          monthly_days: inputs.visual_config?.monthly_days || getDefaultVisualConfig().monthly_days,
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
