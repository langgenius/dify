import type { ScheduleFrequency, ScheduleMode, ScheduleTriggerNodeType } from './types'
import { useCallback, useMemo } from 'react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useAppContext } from '@/context/app-context'
import { getDefaultVisualConfig } from './constants'

const useConfig = (id: string, payload: ScheduleTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const { userProfile } = useAppContext()

  const frontendPayload = useMemo(() => {
    return {
      ...payload,
      mode: payload.mode || 'visual',
      frequency: payload.frequency || 'daily',
      timezone: payload.timezone || userProfile.timezone || 'UTC',
      visual_config: {
        ...getDefaultVisualConfig(),
        ...payload.visual_config,
      },
    }
  }, [payload, userProfile.timezone])

  const { inputs, setInputs } = useNodeCrud<ScheduleTriggerNodeType>(id, frontendPayload)

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
      cron_expression: undefined,
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCronExpressionChange = useCallback((value: string) => {
    const newInputs = {
      ...inputs,
      cron_expression: value,
      frequency: undefined,
      visual_config: undefined,
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
      cron_expression: undefined,
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
      cron_expression: undefined,
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
      cron_expression: undefined,
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
