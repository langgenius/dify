import { useCallback, useMemo } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { ScheduleFrequency, ScheduleMode, ScheduleTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useAppContext } from '@/context/app-context'
import { isUTCFormat, isUserFormat } from './utils/timezone-utils'

dayjs.extend(utc)
dayjs.extend(timezone)

const useConfig = (id: string, payload: ScheduleTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { userProfile } = useAppContext()
  const userTimezone = userProfile?.timezone || payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  // Modern timezone conversion functions using dayjs with manual time parsing
  const convertToUTC = useCallback((time: string, timezone: string): string => {
    if (timezone === 'UTC') {
      // For UTC timezone, convert 12h format to 24h format
      const timeParts = time.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
      if (timeParts) {
        let hour = Number.parseInt(timeParts[1], 10)
        const minute = timeParts[2]
        const period = timeParts[3].toUpperCase()

        if (period === 'PM' && hour !== 12) hour += 12
        if (period === 'AM' && hour === 12) hour = 0

        return `${hour.toString().padStart(2, '0')}:${minute}`
      }
      return time
    }

    try {
      // Manual parsing to avoid dayjs 12h format issues
      const timeParts = time.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
      if (timeParts) {
        let hour = Number.parseInt(timeParts[1], 10)
        const minute = Number.parseInt(timeParts[2], 10)
        const period = timeParts[3].toUpperCase()

        if (period === 'PM' && hour !== 12) hour += 12
        if (period === 'AM' && hour === 12) hour = 0

        const time24h = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        const userTime = dayjs.tz(`2000-01-01 ${time24h}`, 'YYYY-MM-DD HH:mm', timezone)
        return userTime.utc().format('HH:mm')
      }
      return time
    }
 catch {
      return time
    }
  }, [])

  const convertFromUTC = useCallback((utcTime: string, timezone: string): string => {
    if (timezone === 'UTC') {
      // For UTC timezone, convert 24h format to 12h format
      const [hour, minute] = utcTime.split(':')
      const hourNum = Number.parseInt(hour, 10)
      let displayHour = hourNum
      if (hourNum > 12)
        displayHour = hourNum - 12
      else if (hourNum === 0)
        displayHour = 12
      const period = hourNum >= 12 ? 'PM' : 'AM'
      return `${displayHour}:${minute} ${period}`
    }

    try {
      // Parse UTC time and convert to user timezone
      const utcDateTime = dayjs.utc(`2000-01-01 ${utcTime}`, 'YYYY-MM-DD HH:mm')
      return utcDateTime.tz(timezone).format('h:mm A')
    }
 catch {
      return utcTime
    }
  }, [])

  const frontendPayload = useMemo(() => {
    const basePayload = {
      ...payload,
      mode: payload.mode || 'visual',
      frequency: payload.frequency || 'weekly',
      timezone: userTimezone,
      enabled: payload.enabled !== undefined ? payload.enabled : true,
    }

    // Only convert time from UTC to user timezone format when needed
    const needsConversion = payload.visual_config?.time
                          && userTimezone
                          && isUTCFormat(payload.visual_config.time)

    if (needsConversion && payload.visual_config) {
      const userTime = convertFromUTC(payload.visual_config.time!, userTimezone)
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
        time: '11:30 AM',
        weekdays: ['sun'],
        ...payload.visual_config,
      },
    }
  }, [payload, userTimezone, convertFromUTC])

  const { inputs, setInputs: originalSetInputs } = useNodeCrud<ScheduleTriggerNodeType>(id, frontendPayload)

  // Enhanced setInputs with beforeSave logic
  const setInputs = useCallback((data: ScheduleTriggerNodeType) => {
    // Only convert user time format to UTC to avoid duplicate conversions
    if (data.visual_config?.time && userTimezone && isUserFormat(data.visual_config.time)) {
      const utcTime = convertToUTC(data.visual_config.time, userTimezone)
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
  }, [originalSetInputs, userTimezone, convertToUTC])

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
