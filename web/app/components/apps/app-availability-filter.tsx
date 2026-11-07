import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type Availability = NonNullable<NonNullable<GetAppsData['query']>['availability']>

type Props = {
  value: Availability
  onChange: (value: Availability) => void
}

export function AppAvailabilityFilter({ value, onChange }: Props) {
  const { t } = useTranslation(['app'])
  const labelId = useId()
  const options = [
    { value: 'all', label: t(($) => $['studio.availability.all']) },
    { value: 'available', label: t(($) => $['studio.availability.available']) },
    { value: 'unavailable', label: t(($) => $['studio.availability.unavailable']) },
  ] satisfies Array<{ value: Availability; label: string }>

  return (
    <Select<Availability>
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger aria-labelledby={labelId} className="w-auto">
        <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          <span id={labelId} aria-hidden className="shrink-0 font-normal text-text-tertiary">
            {t(($) => $['studio.availability.status'])}
          </span>{' '}
          <SelectValue className="min-w-0 truncate font-medium text-text-secondary" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem<Availability> key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
