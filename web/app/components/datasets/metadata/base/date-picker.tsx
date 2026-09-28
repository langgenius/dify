import { cn } from '@langgenius/dify-ui/cn'
import {
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerTrigger,
  DateTimePickerValue,
} from '@langgenius/dify-ui/date-time-picker'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { DateTimePicker } from '@/app/components/base/date-time-picker/date-time-picker'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useTimestamp from '@/hooks/use-timestamp'

type Props = Readonly<{
  className?: string
  label?: string
  value?: number
  readOnly?: boolean
  onChange: (date: number | null) => void
}>
function WrappedDatePicker({ className, label, value, readOnly, onChange }: Props) {
  const { t } = useTranslation(['common', 'dataset', 'datasetDocuments'])
  const { data: timezone = 'UTC' } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone || 'UTC',
  })
  const { formatTime } = useTimestamp()
  const placeholder = t(($) => $['metadata.chooseTime'], { ns: 'dataset' })
  return (
    <DateTimePicker
      readOnly={readOnly}
      label={label || placeholder}
      placeholder={placeholder}
      value={value === undefined ? null : new Date(value * 1000)}
      timeZone={timezone}
      onValueChange={(next) => onChange(next ? Math.floor(next.getTime() / 1000) : null)}
    >
      <div
        className={cn(
          'flex h-8 w-full items-center rounded-md bg-components-input-bg-normal',
          className,
        )}
      >
        <DateTimePickerTrigger className="h-full min-w-0 flex-1 bg-transparent px-1 text-xs">
          <DateTimePickerValue>
            {value === undefined
              ? placeholder
              : formatTime(
                  value,
                  t(($) => $['metadata.dateTimeFormat'], { ns: 'datasetDocuments' }),
                )}
          </DateTimePickerValue>
          <span
            className="i-ri-calendar-line size-4 shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
        </DateTimePickerTrigger>
        <DateTimePickerClear
          className="size-4"
          label={t(($) => $['operation.clear'], { ns: 'common' })}
        />
      </div>
      <DateTimePickerContent />
    </DateTimePicker>
  )
}
export default WrappedDatePicker
