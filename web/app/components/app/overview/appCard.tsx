'use client'
import React, { useState } from 'react'
import {
  Cog8ToothIcon,
  DocumentTextIcon,
  RocketLaunchIcon,
  ShareIcon,
} from '@heroicons/react/24/outline'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import SettingsModal from './settings'
import ShareLink from './share-link'
import CustomizeModal from './customize'
import Tooltip from '@/app/components/base/tooltip'
import AppBasic, { randomString } from '@/app/components/app-sidebar/basic'
import Button from '@/app/components/base/button'
import Tag from '@/app/components/base/tag'
import Switch from '@/app/components/base/switch'
import type { AppDetailResponse } from '@/models/app'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse
  cardType?: 'app' | 'api'
  customBgColor?: string
  onChangeStatus: (val: boolean) => Promise<any>
  onSaveSiteConfig?: (params: any) => Promise<any>
  onGenerateCode?: () => Promise<any>
}

function AppCard({
  appInfo,
  cardType = 'app',
  customBgColor,
  onChangeStatus,
  onSaveSiteConfig,
  onGenerateCode,
  className,
}: IAppCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const { t } = useTranslation()

  const OPERATIONS_MAP = {
    app: [
      { opName: t('appOverview.overview.appInfo.preview'), opIcon: RocketLaunchIcon },
      { opName: t('appOverview.overview.appInfo.share.entry'), opIcon: ShareIcon },
      { opName: t('appOverview.overview.appInfo.settings.entry'), opIcon: Cog8ToothIcon },
    ],
    api: [{ opName: t('appOverview.overview.apiInfo.doc'), opIcon: DocumentTextIcon }],
  }

  const isApp = cardType === 'app'
  const basicName = isApp ? appInfo?.site?.title : t('appOverview.overview.apiInfo.title')
  const runningStatus = isApp ? appInfo.enable_site : appInfo.enable_api
  const { app_base_url, access_token } = appInfo.site ?? {}
  const appUrl = `${app_base_url}/${appInfo.mode}/${access_token}`
  const apiUrl = appInfo?.api_base_url

  let bgColor = 'bg-primary-50 bg-opacity-40'
  if (cardType === 'api')
    bgColor = 'bg-purple-50'

  const genClickFuncByName = (opName: string) => {
    switch (opName) {
      case t('appOverview.overview.appInfo.preview'):
        return () => {
          window.open(appUrl, '_blank')
        }
      case t('appOverview.overview.appInfo.share.entry'):
        return () => {
          setShowShareModal(true)
        }
      case t('appOverview.overview.appInfo.settings.entry'):
        return () => {
          setShowSettingsModal(true)
        }
      default:
        // jump to page develop
        return () => {
          const pathSegments = pathname.split('/')
          pathSegments.pop()
          router.push(`${pathSegments.join('/')}/develop`)
        }
    }
  }

  const onClickCustomize = () => {
    setShowCustomizeModal(true)
  }

  return (
    <div
      className={`flex flex-col w-full shadow-sm border-[0.5px] rounded-lg border-gray-200 ${className ?? ''}`}
    >
      <div className={`px-6 py-4 ${customBgColor ?? bgColor} rounded-lg`}>
        <div className="mb-2.5 flex flex-row items-start justify-between">
          <AppBasic
            iconType={isApp ? 'app' : 'api'}
            icon={appInfo.icon}
            icon_background={appInfo.icon_background}
            name={basicName}
            type={
              isApp
                ? t('appOverview.overview.appInfo.explanation')
                : t('appOverview.overview.apiInfo.explanation')
            }
          />
          <div className="flex flex-row items-center h-9">
            <Tag className="mr-2" color={runningStatus ? 'green' : 'yellow'}>
              {runningStatus ? t('appOverview.overview.status.running') : t('appOverview.overview.status.disable')}
            </Tag>
            <Switch defaultValue={runningStatus} onChange={onChangeStatus} />
          </div>
        </div>
        <div className="flex flex-col justify-center py-2">
          <div className="py-1">
            <div className="pb-1 text-xs text-gray-500">
              {isApp ? t('appOverview.overview.appInfo.accessibleAddress') : t('appOverview.overview.apiInfo.accessibleAddress')}
            </div>
            <div className="text-sm text-gray-800">
              {isApp ? appUrl : apiUrl}
            </div>
          </div>
        </div>
        <div
          className={`pt-2 flex flex-row items-center ${!isApp ? 'mb-[calc(2rem_+_1px)]' : ''
            }`}
        >
          {OPERATIONS_MAP[cardType].map((op) => {
            return (
              <Button
                className="mr-2 text-gray-800"
                key={op.opName}
                onClick={genClickFuncByName(op.opName)}
                disabled={
                  [t('appOverview.overview.appInfo.preview'), t('appOverview.overview.appInfo.share.entry')].includes(op.opName) && !runningStatus
                }
              >
                <Tooltip
                  content={t('appOverview.overview.appInfo.preUseReminder') ?? ''}
                  selector={`op-btn-${randomString(16)}`}
                  className={
                    ([t('appOverview.overview.appInfo.preview'), t('appOverview.overview.appInfo.share.entry')].includes(op.opName) && !runningStatus)
                      ? 'mt-[-8px]'
                      : '!hidden'
                  }
                >
                  <div className="flex flex-row items-center">
                    <op.opIcon className="h-4 w-4 mr-1.5" />
                    <span className="text-xs">{op.opName}</span>
                  </div>
                </Tooltip>
              </Button>
            )
          })}
        </div>
      </div>
      {isApp
        ? (
          <div
            className={
              'flex items-center px-6 py-2 box-border text-xs text-gray-500 bg-opacity-50 bg-white border-t-[0.5px] border-primary-50'
            }
          >
            <div
              className="flex items-center hover:text-primary-600 hover:cursor-pointer"
              onClick={onClickCustomize}
            >
              <SparklesIcon className="w-4 h-4 mr-1" />
              {t('appOverview.overview.appInfo.customize.entry')}
            </div>
          </div>
        )
        : null}
      {isApp
        ? (
          <div>
            <ShareLink
              isShow={showShareModal}
              onClose={() => setShowShareModal(false)}
              linkUrl={appUrl}
              onGenerateCode={onGenerateCode}
            />
            <SettingsModal
              appInfo={appInfo}
              isShow={showSettingsModal}
              onClose={() => setShowSettingsModal(false)}
              onSave={onSaveSiteConfig}
            />
            <CustomizeModal
              isShow={showCustomizeModal}
              linkUrl=""
              onClose={() => setShowCustomizeModal(false)}
              appId={appInfo.id}
              mode={appInfo.mode}
            />
          </div>
        )
        : null}
    </div>
  )
}

export default AppCard
