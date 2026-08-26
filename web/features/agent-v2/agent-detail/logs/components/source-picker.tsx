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
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from '@langgenius/dify-ui/combobox'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogSourceIcon } from './source-icon'

export type SourceFilterValue = AgentLogSourceResponse['id'][]

const getSourceGroupLabel = (group: AgentLogSourceGroupResponse, t: TFunction<'agentV2'>) => {
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
  onRetry,
  onChange,
}: {
  value: SourceFilterValue
  groups: AgentLogSourceGroupResponse[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onChange: (value: SourceFilterValue) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [inputValue, setInputValue] = useState('')
  const sourceGroups = useMemo<AgentLogSourceComboboxGroup[]>(
    () => groups.map(({ sources, ...group }) => ({ ...group, items: sources ?? [] })),
    [groups],
  )
  const sources = sourceGroups.flatMap((group) => group.items)
  const selectedSources = sources.filter((source) => value.includes(source.id))

  return (
    <Combobox<AgentLogSourceResponse, true>
      multiple
      items={sourceGroups}
      value={selectedSources}
      itemToStringLabel={getSourceLabel}
      onValueChange={(nextSources) => {
        setInputValue('')
        onChange(nextSources.map((source) => source.id))
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
    >
      <ComboboxTrigger
        aria-label={t(($) => $['agentDetail.logs.filters.source.label'])}
        className="mt-0 w-fit max-w-full min-w-22"
      >
        <ComboboxValue<AgentLogSourceResponse, true>
          placeholder={t(($) => $['agentDetail.logs.filters.source.all'])}
        >
          {(selectedValue) => {
            if (!selectedValue?.length) return t(($) => $['agentDetail.logs.filters.source.all'])
            if (selectedValue.length === 1) return selectedValue[0]!.app_name
            return tCommon(($) => $['dynamicSelect.selected'], { count: selectedValue.length })
          }}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup
            aria-label={t(($) => $['agentDetail.logs.filters.source.label'])}
            className="w-80 p-0"
          >
            <div className="p-2 pb-1">
              <ComboboxInputGroup className="h-8 min-h-8 px-2">
                <span
                  aria-hidden
                  className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                />
                <ComboboxInput
                  aria-label={t(($) => $['agentDetail.logs.filters.source.searchLabel'])}
                  placeholder={t(($) => $['agentDetail.logs.filters.source.searchPlaceholder'])}
                  className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
                />
              </ComboboxInputGroup>
            </div>
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
              <ComboboxList<AgentLogSourceComboboxGroup> className="max-h-69 p-2 pt-1">
                {(group) => (
                  <ComboboxGroup key={group.type} items={group.items}>
                    <ComboboxGroupLabel className="px-1 pt-2 pb-1">
                      {getSourceGroupLabel(group, t)}
                    </ComboboxGroupLabel>
                    <ComboboxCollection<AgentLogSourceResponse>>
                      {(source) => (
                        <ComboboxItem
                          key={source.id}
                          value={source}
                          className="min-h-7 grid-cols-[1fr] gap-0 px-1 py-1"
                          render={(props, state) => (
                            <div {...props} className={props.className}>
                              <ComboboxItemText className="flex min-w-0 items-center gap-2 px-0 system-sm-regular">
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
