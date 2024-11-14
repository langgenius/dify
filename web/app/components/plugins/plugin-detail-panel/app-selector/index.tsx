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
// import Button from '@/app/components/base/button'

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
    const appValue = {
      app_id: app.id,
      inputs: value?.inputs || {},
      files: value?.files || [],
    }
    onSelect(appValue)
    setIsShowChooseApp(false)
  }

  // const { data: currentApp } = useAppDetail(value?.app_id || 'empty')

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
          <div className="relative w-[389px] min-h-20 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
            <div className='px-4 py-3 flex flex-col gap-1'>
              <div className='h-6 flex items-center system-sm-semibold text-text-secondary'>{t('app.appSelector.label')}</div>
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
              />
            </div>
            {/* app inputs config panel */}
            <div className='px-4 py-3 flex items-center border-t border-divider-subtle'>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(AppSelector)
