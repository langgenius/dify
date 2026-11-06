'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { PopoverActions } from '@langgenius/dify-ui/popover'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import { AppPicker } from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import { AppTrigger } from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import { consoleQuery } from '@/service/console'
import { appListOptions } from './app-list-query'

export type AppSelectorValue = {
  app_id: string
  inputs: Record<string, unknown>
  files?: unknown[]
}

type AppSelectorProps = {
  value?: AppSelectorValue
  disabled?: boolean
  onSelect: (app: AppSelectorValue) => void
}

export function AppSelector({ value, disabled, onSelect }: AppSelectorProps) {
  const { t } = useTranslation(['app'])
  const pickerActionsRef = useRef<PopoverActions>(null)
  const [selectedApp, setSelectedApp] = useState<AppPartial>()
  const { data } = useInfiniteQuery(appListOptions())

  const { data: selectedAppDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: value?.app_id ? { params: { app_id: value.app_id } } : skipToken,
    }),
  )

  const currentAppInfo = useMemo(() => {
    if (!value?.app_id) return undefined

    return (
      selectedAppDetail ||
      (selectedApp?.id === value.app_id ? selectedApp : undefined) ||
      data?.pages.flatMap((page) => page.data).find((app) => app.id === value.app_id)
    )
  }, [data?.pages, selectedApp, selectedAppDetail, value?.app_id])

  const handleSelectApp = useCallback(
    (app: AppPartial) => {
      setSelectedApp(app)
      pickerActionsRef.current?.close()
      const shouldClearValue = app.id !== value?.app_id

      onSelect({
        app_id: app.id,
        inputs: shouldClearValue ? {} : value?.inputs || {},
        files: shouldClearValue ? [] : value?.files || [],
      })
    },
    [onSelect, value?.app_id, value?.files, value?.inputs],
  )

  const handleFormChange = useCallback(
    (inputs: Record<string, unknown>) => {
      const newFiles = inputs['#image#']
      const nextInputs = { ...inputs }
      delete nextInputs['#image#']

      onSelect({
        app_id: value?.app_id || '',
        inputs: nextInputs,
        files: newFiles ? [newFiles] : value?.files || [],
      })
    },
    [onSelect, value?.app_id, value?.files],
  )

  const formattedInputs = useMemo(
    () => ({
      ...value?.inputs,
      ...(value?.files?.length ? { '#image#': value.files[0] } : {}),
    }),
    [value?.inputs, value?.files],
  )

  return (
    <Popover>
      <PopoverTrigger disabled={disabled} render={<AppTrigger appDetail={currentAppInfo} />} />
      <PopoverContent
        sideOffset={4}
        className="relative min-h-20 w-97.25 max-w-(--available-width) bg-components-panel-bg-blur backdrop-blur-xs"
      >
        <div className="flex flex-col gap-1 px-4 py-3">
          <PopoverTitle className="flex h-6 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['appSelector.label'], { ns: 'app' })}
          </PopoverTitle>
          <Popover actionsRef={pickerActionsRef}>
            <PopoverTrigger render={<AppTrigger appDetail={currentAppInfo} />} />
            <PopoverContent
              align="center"
              sideOffset={4}
              className="relative flex max-h-[min(25rem,var(--available-height))] min-h-20 w-89 max-w-(--available-width) flex-col bg-components-panel-bg-blur backdrop-blur-xs"
            >
              <PopoverTitle className="sr-only">
                {t(($) => $['appSelector.label'], { ns: 'app' })}
              </PopoverTitle>
              <AppPicker value={currentAppInfo ?? null} onSelect={handleSelectApp} />
            </PopoverContent>
          </Popover>
        </div>
        {currentAppInfo && (
          <AppInputsPanel
            key={currentAppInfo.id}
            inputs={formattedInputs}
            appDetail={currentAppInfo}
            onFormChange={handleFormChange}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
