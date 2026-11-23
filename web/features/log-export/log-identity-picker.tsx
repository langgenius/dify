import type { LogIdentity } from './log-identity'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { identityKey } from './log-identity'

type LogIdentityFieldProps = {
  options: LogIdentity[]
  value: LogIdentity[]
  onChange: (value: LogIdentity[]) => void
  disabled: boolean
}

type LogIdentitySearchTarget =
  | { appId: string; workflow?: boolean; agentId?: never }
  | { agentId: string; appId?: never; workflow?: never }

function useLogIdentityMatches(
  { appId, workflow, agentId }: LogIdentitySearchTarget,
  options: LogIdentity[],
  value: LogIdentity[],
  search: string,
) {
  const searchTerm = search.trim()
  const keyword = useDebounce(searchTerm, { wait: 300 })
  const canSearch = searchTerm !== '' && searchTerm === keyword
  const identityOptions = workflow
    ? consoleQuery.apps.byAppId.workflowAppLogs.identityOptions
    : consoleQuery.apps.byAppId.chatConversations.identityOptions
  const settings = { context: { silent: true }, retry: false, refetchOnWindowFocus: false } as const
  const appSearch = useQuery(
    identityOptions.get.queryOptions({
      ...settings,
      input: canSearch && appId ? { params: { app_id: appId }, query: { keyword } } : skipToken,
    }),
  )
  const agentSearch = useQuery(
    consoleQuery.agent.byAgentId.logs.identityOptions.get.queryOptions({
      ...settings,
      input:
        canSearch && agentId ? { params: { agent_id: agentId }, query: { keyword } } : skipToken,
    }),
  )
  const searchOptions = agentId ? agentSearch : appSearch
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
  return { matches, searching, failed: searchOptions.isError }
}

const overflowCountClassName = 'shrink-0 system-xs-medium text-text-tertiary'

function LogIdentitySummary({
  identities,
  placeholder,
}: {
  identities: LogIdentity[]
  placeholder: string
}) {
  const summaryRef = useRef<HTMLSpanElement>(null)
  const measurementRef = useRef<HTMLSpanElement>(null)
  const [visibleCount, setVisibleCount] = useState(1)

  useLayoutEffect(() => {
    const summary = summaryRef.current
    const measurement = measurementRef.current
    if (!summary || !measurement) return

    const fitNames = () => {
      const availableWidth = summary.getBoundingClientRect().width
      let precedingWidth = 0
      let count = 1
      // Each entry measures the next name together with the overflow count it would leave.
      for (const [index, entry] of Array.from(measurement.children).entries()) {
        if (precedingWidth + entry.getBoundingClientRect().width <= availableWidth)
          count = index + 1
        precedingWidth += entry.firstElementChild!.getBoundingClientRect().width
        if (precedingWidth > availableWidth) break
      }
      setVisibleCount(count)
    }

    fitNames()
    const observer = new ResizeObserver(fitNames)
    observer.observe(summary)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [identities])

  const visibleNames = identities
    .slice(0, visibleCount)
    .map(({ label }) => label)
    .join(', ')
  const remaining = identities.length - visibleCount
  return (
    <span
      ref={summaryRef}
      className="relative flex min-w-0 grow items-center gap-1 overflow-hidden"
    >
      <span className="min-w-0 grow truncate">{visibleNames || placeholder}</span>
      {remaining > 0 && (
        <span className={overflowCountClassName} aria-hidden>
          +{remaining}
        </span>
      )}
      {identities.length > 1 && (
        <span
          ref={measurementRef}
          aria-hidden
          className="invisible absolute start-0 flex w-max whitespace-nowrap"
        >
          {identities.map((identity, index) => (
            <span key={identityKey(identity)} className="flex shrink-0 items-center gap-1">
              <span>{index > 0 ? `, ${identity.label}` : identity.label}</span>
              {index < identities.length - 1 && (
                <span className={overflowCountClassName}>+{identities.length - index - 1}</span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

export function LogIdentityField(
  props: LogIdentityFieldProps &
    LogIdentitySearchTarget & { showLabel?: boolean; applyOnClose?: boolean },
) {
  const { options, value, onChange, disabled, showLabel, applyOnClose } = props
  const { t } = useTranslation(['appLog', 'common'])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<LogIdentity[] | null>(null)
  const selected = draft ?? value
  const firstSelected = selected[0]
  const { matches, searching, failed } = useLogIdentityMatches(props, options, selected, search)
  const label = t(($) => $['table.header.endUser'], { ns: 'appLog' })
  const placeholder = showLabel ? t(($) => $['export.identitiesAll'], { ns: 'appLog' }) : label
  const searchLabel = t(($) => $['operation.search'], { ns: 'common' })
  const selectionDescription =
    selected.length > 1
      ? t(($) => $['dynamicSelect.selected'], { ns: 'common', count: selected.length })
      : (firstSelected?.label ?? (showLabel ? placeholder : undefined))

  return (
    <Combobox<LogIdentity, true>
      multiple
      autoHighlight
      disabled={disabled}
      items={matches}
      filter={null}
      inputValue={search}
      onInputValueChange={(next, eventDetails) => {
        if (eventDetails.isItemPress) eventDetails.cancel()
        else setSearch(next)
      }}
      value={selected}
      onValueChange={(next) => {
        if (draft) setDraft(next)
        else onChange(next)
      }}
      onOpenChange={(open) => {
        if (!open) setSearch('')
        if (!applyOnClose) return
        if (open) {
          setDraft(value)
          return
        }
        if (
          draft &&
          (draft.length !== value.length ||
            draft.some((item, index) => identityKey(item) !== identityKey(value[index]!)))
        )
          onChange(draft)
        setDraft(null)
      }}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={identityKey}
      isItemEqualToValue={(item, selection) => identityKey(item) === identityKey(selection)}
    >
      <div className={showLabel ? 'flex flex-col gap-1.5' : 'w-58 max-w-full'}>
        {showLabel && <ComboboxLabel>{label}</ComboboxLabel>}
        <ComboboxTrigger
          aria-label={showLabel ? undefined : label}
          aria-description={selectionDescription}
          className="flex h-8 w-full min-w-0 items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 text-start system-sm-regular text-components-input-text-filled hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled disabled:text-components-input-text-disabled data-placeholder:text-components-input-text-placeholder data-popup-open:bg-state-base-hover-alt"
        >
          {!showLabel && (
            <span className="i-ri-user-line size-4 shrink-0 text-text-tertiary" aria-hidden />
          )}
          <LogIdentitySummary identities={selected} placeholder={placeholder} />
          <ComboboxIcon />
        </ComboboxTrigger>
      </div>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup aria-label={label}>
            <ComboboxInputGroup>
              <span className="i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden />
              <ComboboxInput
                aria-label={searchLabel}
                placeholder={searchLabel}
                enterKeyHint="search"
              />
            </ComboboxInputGroup>
            {searching || failed ? (
              <ComboboxStatus>
                {t(($) => $[searching ? 'dynamicSelect.loading' : 'dynamicSelect.error'], {
                  ns: 'common',
                })}
              </ComboboxStatus>
            ) : (
              <ComboboxEmpty>{t(($) => $['export.noIdentities'], { ns: 'appLog' })}</ComboboxEmpty>
            )}
            <ComboboxList<LogIdentity> className="max-h-48">
              {(item) => (
                <ComboboxItem<LogIdentity> key={identityKey(item)} value={item}>
                  <ComboboxItemText>{item.label}</ComboboxItemText>
                  <ComboboxItemIndicator />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}
