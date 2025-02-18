'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppTrigger from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import AppPicker from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import { useAppFullList } from '@/service/use-apps'
import type { App } from '@/types/app'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'

type Props = {
  value?: {
    app_id: string
    inputs: Record<string, any>
    files?: any[]
  }
  scope?: string
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (app: {
    app_id: string
    inputs: Record<string, any>
    files?: any[]
  }) => void
  supportAddCustomTool?: boolean
}
const AppSelector: FC<Props> = ({
  value,
  scope,
  disabled,
  placement = 'bottom',
  offset = 4,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [isShow, onShowChange] = useState(false)
  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: appList } = useAppFullList()
  const currentAppInfo = useMemo(() => {
    if (!appList?.data || !value)
      return undefined
    return appList.data.find(app => app.id === value.app_id)
  }, [appList?.data, value])

  const [isShowChooseApp, setIsShowChooseApp] = useState(false)
  const handleSelectApp = (app: App) => {
    const clearValue = app.id !== value?.app_id
    const appValue = {
      app_id: app.id,
      inputs: clearValue ? {} : value?.inputs || {},
      files: clearValue ? [] : value?.files || [],
    }
    onSelect(appValue)
    setIsShowChooseApp(false)
  }
  const handleFormChange = (inputs: Record<string, any>) => {
    const newFiles = inputs['#image#']
    delete inputs['#image#']
    const newValue = {
      app_id: value?.app_id || '',
      inputs,
      files: newFiles ? [newFiles] : value?.files || [],
    }
    onSelect(newValue)
  }

  const formattedValue = useMemo(() => {
    return {
      app_id: value?.app_id || '',
      inputs: {
        ...value?.inputs,
        ...(value?.files?.length ? { '#image#': value.files[0] } : {}),
      },
    }
  }, [value])

  return (
    <>
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          className='w-full'
          onClick={handleTriggerClick}
        >
          <AppTrigger
            open={isShow}
            appDetail={currentAppInfo}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className="bg-components-panel-bg-blur border-components-panel-border relative min-h-20 w-[389px] rounded-xl border-[0.5px] shadow-lg backdrop-blur-sm">
            <div className='flex flex-col gap-1 px-4 py-3'>
              <div className='system-sm-semibold text-text-secondary flex h-6 items-center'>{t('app.appSelector.label')}</div>
              <AppPicker
                placement='bottom'
                offset={offset}
                trigger={
                  <AppTrigger
                    open={isShowChooseApp}
                    appDetail={currentAppInfo}
                  />
                }
                isShow={isShowChooseApp}
                onShowChange={setIsShowChooseApp}
                disabled={false}
                appList={appList?.data || []}
                onSelect={handleSelectApp}
                scope={scope || 'all'}
              />
            </div>
            {/* app inputs config panel */}
            {currentAppInfo && (
              <AppInputsPanel
                value={formattedValue}
                appDetail={currentAppInfo}
                onFormChange={handleFormChange}
              />
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(AppSelector)
