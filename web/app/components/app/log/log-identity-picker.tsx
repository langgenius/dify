import type { LogIdentity } from './log-filters'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import { identityKey } from './log-filters'

export function LogIdentityPicker({
  appId,
  options,
  value,
  onChange,
  disabled,
}: {
  appId: string
  options: LogIdentity[]
  value: LogIdentity[]
  onChange: (value: LogIdentity[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['appLog', 'common'])
  const [search, setSearch] = useState('')
  const [optionsOnOpen, setOptionsOnOpen] = useState<LogIdentity[]>([])
  const searchTerm = search.trim()
  const keyword = useDebounce(searchTerm, { wait: 300 })
  const searchOptions = useQuery(
    consoleQuery.apps.byAppId.chatConversations.identityOptions.get.queryOptions({
      input:
        searchTerm && searchTerm === keyword
          ? { params: { app_id: appId }, query: { keyword } }
          : skipToken,
      context: { silent: true },
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )
  const selected = new Set(value.map(identityKey))
  const localSearch = searchTerm.toLowerCase()
  const localMatches = [...optionsOnOpen, ...options, ...value].filter(
    ({ id, label }) =>
      id.toLowerCase().includes(localSearch) || label.toLowerCase().includes(localSearch),
  )
  const matches = [
    ...new Map(
      [...localMatches, ...(searchOptions.data?.data ?? [])].map((item) => [
        identityKey(item),
        item,
      ]),
    ).values(),
  ]
  const searching = searchTerm !== '' && (searchTerm !== keyword || searchOptions.isPending)
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
          {matches.map((item) => {
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
          })}
          {(searching || searchOptions.isError || matches.length === 0) && (
            <p role="status" className="px-2 py-3 system-sm-regular text-text-tertiary">
              {searching
                ? t(($) => $['dynamicSelect.loading'], { ns: 'common' })
                : searchOptions.isError
                  ? t(($) => $['dynamicSelect.error'], { ns: 'common' })
                  : t(($) => $['export.noIdentities'], { ns: 'appLog' })}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
