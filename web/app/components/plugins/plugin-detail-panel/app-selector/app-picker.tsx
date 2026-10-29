'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
} from '@langgenius/dify-ui/combobox'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { appListOptions } from './app-list-query'

type AppPickerProps = {
  value: AppPartial | null
  onSelect: (app: AppPartial) => void
}

function getAppTypeLabel(app: AppPartial) {
  switch (app.mode) {
    case 'advanced-chat':
      return 'chatflow'
    case 'agent-chat':
      return 'agent'
    case 'chat':
      return 'chat'
    case 'completion':
      return 'completion'
    case 'workflow':
      return 'workflow'
    default:
      return app.mode
  }
}

function AppPickerOption({ app }: { app: AppPartial }) {
  return (
    <ComboboxItem
      key={app.id}
      value={app}
      className="grid-cols-[minmax(0,1fr)_auto] gap-3 py-1 ps-2 pe-3"
    >
      <ComboboxItemText className="flex items-center gap-3">
        <AppIcon className="shrink-0" size="xs" icon={app} />
        <span className="min-w-0 grow truncate system-sm-medium text-components-input-text-filled">
          <span className="me-1">{app.name}</span>
          <span className="text-text-tertiary">({app.id.slice(0, 8)})</span>
        </span>
      </ComboboxItemText>
      <span className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">
        {getAppTypeLabel(app)}
      </span>
    </ComboboxItem>
  )
}

export function AppPicker({ value, onSelect }: AppPickerProps) {
  const { t } = useTranslation(['app', 'common', 'workflow'])
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debouncedSearchText = useDebouncedValue(searchText, 500)
  const {
    data,
    isPending,
    isError,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteQuery(appListOptions(debouncedSearchText))
  const isDebouncing = searchText !== debouncedSearchText
  const isLoading = isDebouncing || isPending
  const showError = !isDebouncing && isError
  const apps =
    isLoading || (showError && !isFetchNextPageError)
      ? []
      : (data?.pages.flatMap((page) => page.data) ?? [])

  return (
    <Combobox<AppPartial>
      inline
      open
      items={apps}
      inputValue={searchText}
      onInputValueChange={setSearchText}
      onValueChange={(app) => {
        if (app) onSelect(app)
      }}
      itemToStringLabel={(app) => app.name}
      filter={null}
      value={value}
      isItemEqualToValue={(app, selectedApp) => app.id === selectedApp.id}
    >
      <ComboboxInputGroup className="mx-1 mt-1 w-auto">
        <span className="i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden />
        <ComboboxInput
          ref={inputRef}
          aria-label={t(($) => $['appSelector.searchPlaceholder'], { ns: 'app' })}
          placeholder={t(($) => $['appSelector.searchPlaceholder'], { ns: 'app' })}
        />
      </ComboboxInputGroup>
      <ScrollArea className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollAreaViewport
          className="h-auto min-h-0 flex-1"
          role="region"
          aria-label={t(($) => $['appSelector.label'], { ns: 'app' })}
          style={{ overflowX: 'hidden' }}
        >
          <ScrollAreaContent className="p-1" style={{ minWidth: 0 }}>
            <ComboboxStatus>
              {isLoading || isFetchingNextPage ? t(($) => $.loading, { ns: 'common' }) : null}
            </ComboboxStatus>
            <ComboboxList<AppPartial> className="max-h-none overflow-visible p-0">
              {(app) => <AppPickerOption key={app.id} app={app} />}
            </ComboboxList>
            <ComboboxEmpty>
              {!isLoading && !showError ? t(($) => $.noData, { ns: 'common' }) : null}
            </ComboboxEmpty>
            {showError && (
              <div className="flex flex-col items-center gap-1 px-3 py-2">
                <span role="status" className="system-xs-regular text-text-tertiary">
                  {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
                </span>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={isFetching}
                  onClick={() => {
                    inputRef.current?.focus()
                    if (isFetchNextPageError) void fetchNextPage()
                    else void refetch()
                  }}
                >
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </div>
            )}
            {!isLoading && !showError && hasNextPage && (
              <div className="flex justify-center px-3 py-2">
                <Button
                  size="small"
                  disabled={isFetchingNextPage}
                  onClick={() => {
                    void fetchNextPage()
                  }}
                >
                  {isFetchingNextPage
                    ? t(($) => $.loading, { ns: 'common' })
                    : t(($) => $['common.loadMore'], { ns: 'workflow' })}
                </Button>
              </div>
            )}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>
    </Combobox>
  )
}
