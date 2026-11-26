import type { LogIdentity } from './log-identity'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxClear,
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

type LogIdentityOption = LogIdentity | 'all'

function optionKey(option: LogIdentityOption) {
  return option === 'all' ? option : identityKey(option)
}

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = draft ?? value
  const hasSelection = selected.length > 0
  const { matches, searching, failed } = useLogIdentityMatches(props, options, selected, search)
  const label = t(($) => $['table.header.endUser'], { ns: 'appLog' })
  const allLabel = t(($) => $[showLabel ? 'export.identitiesAll' : 'status.all'], { ns: 'appLog' })
  const searchLabel = t(($) => $['operation.search'], { ns: 'common' })
  const items: LogIdentityOption[] = search.trim() ? matches : ['all', ...matches]
  const optionLabel = (option: LogIdentityOption) => (option === 'all' ? allLabel : option.label)
  const selectionDescription =
    selected.length > 1
      ? t(($) => $['dynamicSelect.selected'], { ns: 'common', count: selected.length })
      : (selected[0]?.label ?? allLabel)

  return (
    <Combobox<LogIdentityOption, true>
      multiple
      autoHighlight
      disabled={disabled}
      items={items}
      filter={null}
      inputValue={search}
      onInputValueChange={(next, eventDetails) => {
        if (eventDetails.isItemPress) eventDetails.cancel()
        else setSearch(next)
      }}
      value={hasSelection ? selected : ['all']}
      onValueChange={(next) => {
        const identities =
          hasSelection && next.includes('all') ? [] : next.filter((item) => item !== 'all')
        if (!identities.length && !hasSelection) return
        if (draft) setDraft(identities)
        else onChange(identities)
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
      itemToStringLabel={optionLabel}
      itemToStringValue={optionKey}
      isItemEqualToValue={(item, selection) => optionKey(item) === optionKey(selection)}
    >
      <div
        className={cn(
          showLabel ? 'flex flex-col gap-1.5' : 'w-fit max-w-full',
          !showLabel && hasSelection && 'w-58',
        )}
      >
        {showLabel && <ComboboxLabel>{label}</ComboboxLabel>}
        <div className="relative">
          <ComboboxTrigger
            ref={triggerRef}
            aria-label={showLabel ? undefined : label}
            aria-description={selectionDescription}
            className={cn(
              'flex h-8 w-full min-w-0 items-center gap-1 rounded-lg text-start system-sm-regular disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled disabled:text-components-input-text-disabled',
              showLabel
                ? 'bg-components-input-bg-normal ps-3 pe-2 text-components-input-text-filled hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt'
                : 'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-text-secondary shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover data-popup-open:border-components-button-secondary-border-hover data-popup-open:bg-components-button-secondary-bg-hover',
            )}
          >
            {!showLabel && (
              <span className="i-ri-user-line size-4 shrink-0 text-text-tertiary" aria-hidden />
            )}
            <LogIdentitySummary identities={selected} placeholder={showLabel ? allLabel : label} />
            {!showLabel && !hasSelection && (
              <span className="shrink-0 system-sm-medium whitespace-nowrap">{allLabel}</span>
            )}
            {hasSelection && <span className="size-5 shrink-0" aria-hidden />}
            {(showLabel || !hasSelection) && <ComboboxIcon />}
          </ComboboxTrigger>
          {hasSelection && (
            <ComboboxClear
              keepMounted
              tabIndex={0}
              className={cn(
                'absolute top-1/2 -translate-y-1/2',
                showLabel ? 'inset-e-7' : 'group/clear inset-e-1.5',
              )}
              aria-label={`${t(($) => $['operation.clear'], { ns: 'common' })} ${label}`}
              onClick={() => triggerRef.current?.focus()}
            >
              {showLabel ? undefined : (
                <span
                  aria-hidden
                  className="i-ri-close-circle-fill size-3.5 text-text-quaternary group-hover/clear:text-text-tertiary"
                />
              )}
            </ComboboxClear>
          )}
        </div>
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
            <ComboboxList<LogIdentityOption> className="max-h-48">
              {(item) => (
                <ComboboxItem<LogIdentityOption> key={optionKey(item)} value={item}>
                  <ComboboxItemText>{optionLabel(item)}</ComboboxItemText>
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
