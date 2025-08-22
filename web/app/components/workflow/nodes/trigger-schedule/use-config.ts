import { useCallback } from 'react'
import type { ScheduleFrequency, ScheduleMode, ScheduleTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: ScheduleTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const defaultPayload = {
    ...payload,
    mode: payload.mode || 'visual',
    frequency: payload.frequency || 'weekly',
    visual_config: {
      time: '11:30 AM',
      weekdays: ['sun'],
      ...payload.visual_config,
    },
    timezone: payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: payload.enabled !== undefined ? payload.enabled : true,
  }

  const { inputs, setInputs } = useNodeCrud<ScheduleTriggerNodeType>(id, defaultPayload)

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
        ...(frequency === 'hourly') && !inputs.visual_config?.datetime && {
          datetime: new Date().toISOString(),
        },
        ...(frequency === 'hourly') && {
          recur_every: inputs.visual_config?.recur_every || 1,
          recur_unit: inputs.visual_config?.recur_unit || 'hours',
        },
        ...(frequency !== 'hourly') && {
          datetime: undefined,
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

  const handleRecurEveryChange = useCallback((recur_every: number) => {
    const newInputs = {
      ...inputs,
      visual_config: {
        ...inputs.visual_config,
        recur_every,
      },
    }
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRecurUnitChange = useCallback((recur_unit: 'hours' | 'minutes') => {
    const newInputs = {
      ...inputs,
      visual_config: {
        ...inputs.visual_config,
        recur_unit,
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
    handleRecurEveryChange,
    handleRecurUnitChange,
  }
}

export default useConfig
