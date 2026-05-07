'use client'

import type { Placement } from '@langgenius/dify-ui/combobox'
import type { ReactNode } from 'react'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AppModeEnum } from '@/types/app'

type AppPickerProps = {
  scope?: string
  disabled: boolean
  trigger: ReactNode
  placement?: Placement
  offset?: number
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  onSelect: (app: App) => void
  apps: App[]
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  searchText: string
  onSearchChange: (text: string) => void
}

function getAppTypeLabel(app: App) {
  switch (app.mode) {
    case AppModeEnum.ADVANCED_CHAT:
      return 'chatflow'
    case AppModeEnum.AGENT_CHAT:
      return 'agent'
    case AppModeEnum.CHAT:
      return 'chat'
    case AppModeEnum.COMPLETION:
      return 'completion'
    case AppModeEnum.WORKFLOW:
      return 'workflow'
    default:
      return app.mode
  }
}

function getAppSearchText(app: App) {
  return `${app.name} ${app.id} ${getAppTypeLabel(app)}`
}

function AppPickerOption({
  app,
}: {
  app: App
}) {
  return (
    <ComboboxItem
      key={app.id}
      value={app}
      className="mx-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-1 pr-3 pl-2"
    >
      <ComboboxItemText className="flex min-w-0 items-center gap-3 px-0">
        <AppIcon
          className="shrink-0"
          size="xs"
          iconType={app.icon_type}
          icon={app.icon}
          background={app.icon_background}
          imageUrl={app.icon_url}
        />
        <span title={`${app.name} (${app.id})`} className="min-w-0 grow truncate system-sm-medium text-components-input-text-filled">
          <span className="mr-1">{app.name}</span>
          <span className="text-text-tertiary">
            (
            {app.id.slice(0, 8)}
            )
          </span>
        </span>
      </ComboboxItemText>
      <span className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">{getAppTypeLabel(app)}</span>
    </ComboboxItem>
  )
}

export function AppPicker({
  disabled,
  trigger,
  placement = 'right-start',
  offset = 0,
  isShow,
  onShowChange,
  onSelect,
  apps,
  isLoading,
  hasMore,
  onLoadMore,
  searchText,
  onSearchChange,
}: AppPickerProps) {
  const { t } = useTranslation()

  const handleValueChange = useCallback((app: App | null) => {
    if (!app)
      return

    onSelect(app)
    onShowChange(false)
  }, [onSelect, onShowChange])

  return (
    <Combobox<App>
      items={apps}
      open={isShow}
      inputValue={searchText}
      onOpenChange={onShowChange}
      onInputValueChange={onSearchChange}
      onValueChange={handleValueChange}
      itemToStringLabel={app => app?.name ?? ''}
      itemToStringValue={app => app?.id ?? ''}
      filter={(app, query) => getAppSearchText(app).toLowerCase().includes(query.toLowerCase())}
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-label={t('appSelector.label', { ns: 'app' })}
        icon={false}
        className="block h-auto w-full border-0 bg-transparent p-0 text-left hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 data-open:bg-transparent"
      >
        {trigger}
      </ComboboxTrigger>
      <ComboboxContent
        placement={placement}
        sideOffset={offset}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="relative flex max-h-100 min-h-20 w-89 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <ComboboxInputGroup className="h-8 min-h-8 px-2">
              <span className="mr-0.5 i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <ComboboxInput
                aria-label={t('appSelector.placeholder', { ns: 'app' })}
                placeholder={t('appSelector.placeholder', { ns: 'app' })}
                className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
              />
              {searchText && (
                <button
                  type="button"
                  aria-label={t('operation.clear', { ns: 'common' })}
                  className="ml-1.5 flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-none text-text-quaternary outline-hidden hover:bg-transparent hover:text-text-quaternary focus-visible:ring-1 focus-visible:ring-components-input-border-active"
                  onClick={() => onSearchChange('')}
                >
                  <span className="i-custom-vender-solid-general-x-circle size-3.5" aria-hidden="true" />
                </button>
              )}
            </ComboboxInputGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {isLoading && (
              <ComboboxStatus>
                {t('loading', { ns: 'common' })}
              </ComboboxStatus>
            )}
            <ComboboxList className="max-h-none p-0">
              {(app: App) => (
                <AppPickerOption key={app.id} app={app} />
              )}
            </ComboboxList>
            <ComboboxEmpty>
              {t('noData', { ns: 'common' })}
            </ComboboxEmpty>
            {hasMore && (
              <div className="flex justify-center px-3 py-2">
                <Button
                  size="small"
                  disabled={isLoading}
                  onClick={() => onLoadMore()}
                >
                  {isLoading ? t('loading', { ns: 'common' }) : t('common.loadMore', { ns: 'workflow' })}
                </Button>
              </div>
            )}
          </div>
        </div>
      </ComboboxContent>
    </Combobox>
  )
}
