'use client'
import type { FC } from 'react'
import { RiBookReadLine, RiCloseLine } from '@remixicon/react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { usePluginReadme } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'
import DetailHeader from '../plugin-detail-panel/detail-header'
import { ReadmeShowType, useReadmePanelStore } from './store'

const ReadmePanel: FC = () => {
  const { currentPluginDetail, setCurrentPluginDetail } = useReadmePanelStore()
  const { detail, showType } = currentPluginDetail || {}
  const { t } = useTranslation()
  const language = useLanguage()

  const pluginUniqueIdentifier = detail?.plugin_unique_identifier || ''

  const { data: readmeData, isLoading, error } = usePluginReadme(
    { plugin_unique_identifier: pluginUniqueIdentifier, language: language === 'zh-Hans' ? undefined : language },
  )

  const onClose = () => {
    setCurrentPluginDetail()
  }

  if (!detail)
    return null

  const children = (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="rounded-t-xl bg-background-body px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <RiBookReadLine className="h-3 w-3 text-text-tertiary" />
            <span className="text-xs font-medium uppercase text-text-tertiary">
              {t('readmeInfo.title', { ns: 'plugin' })}
            </span>
          </div>
          <ActionButton onClick={onClose}>
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
        <DetailHeader detail={detail} isReadmeView={true} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {(() => {
          if (isLoading) {
            return (
              <div className="flex h-40 items-center justify-center">
                <Loading type="area" />
              </div>
            )
          }

          if (error) {
            return (
              <div className="py-8 text-center text-text-tertiary">
                <p>{t('readmeInfo.failedToFetch', { ns: 'plugin' })}</p>
              </div>
            )
          }

          if (readmeData?.readme) {
            return (
              <Markdown
                content={readmeData.readme}
                pluginInfo={{ pluginUniqueIdentifier, pluginId: detail.plugin_id }}
              />
            )
          }

          return (
            <div className="py-8 text-center text-text-tertiary">
              <p>{t('readmeInfo.noReadmeAvailable', { ns: 'plugin' })}</p>
            </div>
          )
        })()}
      </div>
    </div>
  )

  const portalContent = showType === ReadmeShowType.drawer
    ? (
        <div className="fixed inset-0 z-[999] flex justify-start" onClick={onClose}>
          <div
            className={cn(
              'pointer-events-auto mb-2 ml-2 mr-2 mt-16 w-[600px] max-w-[600px] justify-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl',
            )}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {children}
          </div>
        </div>
      )
    : (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-2" onClick={onClose}>
          <div
            className={cn(
              'pointer-events-auto relative h-[calc(100vh-16px)] w-full max-w-[800px] rounded-2xl bg-components-panel-bg p-0 shadow-xl',
            )}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {children}
          </div>
        </div>
      )

  return createPortal(
    portalContent,
    document.body,
  )
}

export default ReadmePanel
