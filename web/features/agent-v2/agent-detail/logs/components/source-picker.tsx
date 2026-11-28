import type {
  AgentLogSourceGroupResponse,
  AgentLogSourceResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { TFunction } from 'i18next'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogSourceIcon } from './source-icon'

export type SourceFilterValue = AgentLogSourceResponse['id'][]

const getSourceGroupLabel = (group: AgentLogSourceGroupResponse, t: TFunction<['agentV2']>) => {
  if (group.type === 'webapp') return t(($) => $['agentDetail.logs.filters.source.webapp'])
  if (group.type === 'workflow') return t(($) => $['agentDetail.logs.filters.source.workflow'])
  return group.label
}

const getSourceLabel = (source: AgentLogSourceResponse) => source.app_name

type AgentLogSourceComboboxGroup = Omit<AgentLogSourceGroupResponse, 'sources'> & {
  items: AgentLogSourceResponse[]
}

export function AgentLogSourcePicker({
  value,
  groups,
  isLoading,
  isError,
  disabled,
  showLabel,
  onRetry,
  onChange,
}: {
  value: SourceFilterValue
  groups: AgentLogSourceGroupResponse[]
  isLoading: boolean
  isError: boolean
  disabled?: boolean
  showLabel?: boolean
  onRetry: () => void
  onChange: (value: SourceFilterValue) => void
}) {
  const { t } = useTranslation(['agentV2', 'common'])
  const { t: tCommon } = useTranslation(['common'])
  const label = t(($) => $['agentDetail.logs.filters.source.label'])
  const placeholder = showLabel
    ? t(($) => $['agentDetail.monitoring.sources.all'])
    : t(($) => $['agentDetail.logs.filters.source.all'])
  const [inputValue, setInputValue] = useState('')
  const sourceGroups = useMemo<AgentLogSourceComboboxGroup[]>(
    () => groups.map(({ sources, ...group }) => ({ ...group, items: sources ?? [] })),
    [groups],
  )
  const sourceItems = useMemo(
    () =>
      createComboboxItems(sourceGroups, {
        getValue: (source) => source.id,
        getLabel: getSourceLabel,
      }),
    [sourceGroups],
  )
  const sourceById = useMemo(
    () =>
      new Map(sourceGroups.flatMap((group) => group.items).map((source) => [source.id, source])),
    [sourceGroups],
  )

  return (
    <Combobox<AgentLogSourceResponse['id'], true, AgentLogSourceResponse>
      multiple
      disabled={disabled}
      items={sourceItems}
      value={value}
      onValueChange={(nextValue) => {
        setInputValue('')
        onChange(nextValue)
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
    >
      <div className={showLabel ? 'flex flex-col gap-1.5' : 'max-w-full min-w-0'}>
        {showLabel && <ComboboxLabel>{label}</ComboboxLabel>}
        <ComboboxTrigger
          aria-label={showLabel ? undefined : label}
          className={cn(
            'group/source-trigger flex h-8 max-w-full min-w-22 items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-3 py-2 text-start system-sm-regular text-components-input-text-filled transition-colors hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled disabled:text-components-input-text-disabled data-placeholder:text-components-input-text-placeholder data-popup-open:bg-state-base-hover-alt motion-reduce:transition-none',
            showLabel ? 'w-full' : 'w-fit',
          )}
        >
          <span className="min-w-0 grow truncate">
            <ComboboxValue<AgentLogSourceResponse['id'], true> placeholder={placeholder}>
              {(selectedValue) => {
                if (!selectedValue?.length) return placeholder
                if (selectedValue.length === 1) {
                  return (
                    sourceById.get(selectedValue[0]!)?.app_name ??
                    tCommon(($) => $['dynamicSelect.selected'], { count: 1 })
                  )
                }
                return tCommon(($) => $['dynamicSelect.selected'], { count: selectedValue.length })
              }}
            </ComboboxValue>
          </span>
          <ComboboxIcon className="block text-text-quaternary transition-colors group-hover/source-trigger:text-text-secondary group-data-popup-open/source-trigger:text-text-secondary" />
        </ComboboxTrigger>
      </div>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup aria-label={label} className="w-80 max-w-[calc(100vw-1rem)] p-0">
            <ComboboxInputGroup>
              <span
                aria-hidden
                className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
              />
              <ComboboxInput
                aria-label={t(($) => $['agentDetail.logs.filters.source.searchLabel'])}
                placeholder={t(($) => $['agentDetail.logs.filters.source.searchPlaceholder'])}
              />
            </ComboboxInputGroup>
            <div
              className={cn(
                isLoading || isError
                  ? 'flex items-center justify-center gap-2 px-3 py-3 text-center system-xs-regular text-text-tertiary'
                  : 'h-0',
              )}
            >
              <ComboboxStatus className="p-0 system-xs-regular">
                {isLoading
                  ? t(($) => $['agentDetail.logs.filters.source.loading'])
                  : isError
                    ? t(($) => $['agentDetail.logs.filters.source.loadFailed'])
                    : null}
              </ComboboxStatus>
              {isError && (
                <Button variant="secondary" size="small" onClick={onRetry}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              )}
            </div>
            {!isLoading && !isError && (
              <ComboboxList<AgentLogSourceComboboxGroup> className="max-h-69">
                {(group) => (
                  <ComboboxGroup<AgentLogSourceResponse> key={group.type} items={group.items}>
                    <ComboboxGroupLabel className="px-1 pt-2 pb-1">
                      {getSourceGroupLabel(group, t)}
                    </ComboboxGroupLabel>
                    <ComboboxCollection<AgentLogSourceResponse>>
                      {(source) => (
                        <ComboboxItem<AgentLogSourceResponse['id']>
                          key={source.id}
                          value={source.id}
                          className="min-h-7 grid-cols-[1fr] gap-0 px-1 py-1"
                          render={(props, state) => (
                            <div {...props} className={props.className}>
                              <ComboboxItemText className="flex items-center gap-2 system-sm-regular">
                                <SourceCheckbox checked={state.selected} />
                                <LogSourceIcon source={source} />
                                <span className="min-w-0 flex-1 truncate">{source.app_name}</span>
                              </ComboboxItemText>
                            </div>
                          )}
                        />
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            )}
            <ComboboxEmpty className="px-3 py-3 text-center system-xs-regular">
              {!isLoading && !isError ? t(($) => $['agentDetail.logs.filters.source.empty']) : null}
            </ComboboxEmpty>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}

function SourceCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm border shadow-xs shadow-shadow-shadow-3',
        checked
          ? 'border-transparent bg-components-checkbox-bg text-components-checkbox-icon'
          : 'border-components-checkbox-border bg-components-checkbox-bg-unchecked',
      )}
    >
      {checked && <span className="i-ri-check-line size-3" />}
    </span>
  )
}
