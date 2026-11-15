import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  DateTimePicker,
  DateTimePickerClear,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '@/app/components/base/date-time-picker/date-time-picker'
import { userProfileQueryOptions } from '@/features/account-profile/client'

type ConditionDateProps = { value?: number; disabled?: boolean; onChange: (date?: number) => void }
function ConditionDate({ value, disabled, onChange }: ConditionDateProps) {
  const { t } = useTranslation(['common', 'workflowModels'])
  const { data: timezone = 'UTC' } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone || 'UTC',
  })
  const label = t(($) => $['nodes.knowledgeRetrieval.metadata.panel.datePlaceholder'], {
    ns: 'workflowModels',
  })
  return (
    <DateTimePicker
      disabled={disabled}
      placeholder={label}
      timeZone={timezone}
      value={value === undefined ? null : new Date(value * 1000)}
      onValueChange={(next) => onChange(next ? Math.floor(next.getTime() / 1000) : undefined)}
    >
      <DateTimePickerLabel className="sr-only">{label}</DateTimePickerLabel>
      <div className="flex items-center px-2">
        <DateTimePickerTrigger className="min-w-0 flex-1 bg-transparent px-1" />
        <DateTimePickerClear aria-label={t(($) => $['operation.clear'], { ns: 'common' })} />
      </div>
      <DateTimePickerContent />
    </DateTimePicker>
  )
}
export default ConditionDate
