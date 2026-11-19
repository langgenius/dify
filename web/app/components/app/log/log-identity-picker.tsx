import type { LogIdentity } from './log-filters'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { identityKey } from './log-filters'

export function LogIdentityPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: LogIdentity[]
  value: LogIdentity[]
  onChange: (value: LogIdentity[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['appLog', 'common'])
  const [search, setSearch] = useState('')
  const [optionsOnOpen, setOptionsOnOpen] = useState<LogIdentity[]>([])
  const searchTerm = search.trim().toLowerCase()
  const selected = new Set(value.map(identityKey))
  const candidates = [
    ...new Map(
      [...optionsOnOpen, ...options, ...value].map((item) => [identityKey(item), item]),
    ).values(),
  ]
  const matches = candidates.filter(
    ({ id, label }) =>
      id.toLowerCase().includes(searchTerm) || label.toLowerCase().includes(searchTerm),
  )
  const label = t(($) => $['table.header.endUser'], { ns: 'appLog' })

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setOptionsOnOpen(options)
        else {
          setOptionsOnOpen([])
          setSearch('')
        }
      }}
    >
      <PopoverTrigger render={<Button type="button" size="small" disabled={disabled} />}>
        <span className="i-ri-user-line size-4" aria-hidden />
        {label}
        {value.length > 0 && (
          <span className="system-xs-semibold text-text-accent">{value.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-76">
        <div className="flex items-center gap-2">
          <SearchInput
            className="min-w-0 flex-1"
            value={search}
            onValueChange={setSearch}
            placeholder={t(($) => $['operation.search'], { ns: 'common' })}
          />
          {value.length > 0 && (
            <Button type="button" size="small" variant="ghost" onClick={() => onChange([])}>
              {t(($) => $['operation.clear'], { ns: 'common' })}
            </Button>
          )}
        </div>
        <p className="px-1 pt-2 pb-1 system-xs-regular text-text-tertiary">
          {t(($) => $['export.identityHint'], { ns: 'appLog' })}
        </p>
        <div role="group" aria-label={label} className="max-h-60 overflow-y-auto">
          {matches.length ? (
            matches.map((item) => {
              const key = identityKey(item)
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                >
                  <Checkbox
                    checked={selected.has(key)}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...value, item]
                          : value.filter((entry) => identityKey(entry) !== key),
                      )
                    }
                  />
                  <span className="min-w-0 system-sm-regular wrap-break-word text-text-secondary">
                    {item.label}
                  </span>
                </label>
              )
            })
          ) : (
            <p className="px-2 py-3 system-sm-regular text-text-tertiary">
              {t(($) => $['export.noIdentities'], { ns: 'appLog' })}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
