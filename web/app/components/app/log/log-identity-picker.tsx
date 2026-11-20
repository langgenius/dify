import type { LogIdentity } from './log-filters'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
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
  disabled: boolean
}) {
  const { t } = useTranslation(['appLog', 'common'])
  const [search, setSearch] = useState('')
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
  const localMatches = [...options, ...value].filter(
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
    <div className="rounded-lg border border-divider-regular p-2">
      <SearchInput
        value={search}
        onValueChange={setSearch}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault()
        }}
      />
      <div role="group" aria-label={label} className="max-h-40 overflow-y-auto overscroll-contain">
        {matches.map((item) => {
          const key = identityKey(item)
          return (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
            >
              <Checkbox
                checked={selected.has(key)}
                disabled={disabled}
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
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Button
              key={identityKey(item)}
              type="button"
              size="small"
              disabled={disabled}
              aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${item.label}`}
              onClick={() => onChange(value.filter((entry) => item !== entry))}
            >
              <span className="max-w-32 truncate">{item.label}</span>
              <span className="i-ri-close-line size-3" aria-hidden />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
