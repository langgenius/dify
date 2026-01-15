import * as React from 'react'
import { useMemo } from 'react'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { cn } from '@/utils/classnames'

export type TimezoneLabelProps = {
  /** IANA timezone identifier (e.g., 'Asia/Shanghai', 'America/New_York') */
  timezone: string
  /** Additional CSS classes to apply */
  className?: string
  /** Use inline mode with lighter text color for secondary display */
  inline?: boolean
}

/**
 * TimezoneLabel component displays timezone information in UTC offset format.
 *
 * @example
 * // Standard display
 * <TimezoneLabel timezone="Asia/Shanghai" />
 * // Output: UTC+8
 *
 * @example
 * // Inline mode with lighter color
 * <TimezoneLabel timezone="America/New_York" inline />
 * // Output: UTC-5
 *
 * @example
 * // Custom styling
 * <TimezoneLabel timezone="Europe/London" className="text-xs font-bold" />
 */
const TimezoneLabel: React.FC<TimezoneLabelProps> = ({
  timezone,
  className,
  inline = false,
}) => {
  // Memoize offset calculation to avoid redundant computations
  const offsetStr = useMemo(
    () => convertTimezoneToOffsetStr(timezone),
    [timezone],
  )

  return (
    <span
      className={cn(
        'system-sm-regular text-text-tertiary',
        inline && 'text-text-quaternary',
        className,
      )}
      title={`Timezone: ${timezone} (${offsetStr})`}
    >
      {offsetStr}
    </span>
  )
}

export default React.memo(TimezoneLabel)
