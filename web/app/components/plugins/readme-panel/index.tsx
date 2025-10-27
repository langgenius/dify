'use client'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import Modal from '@/app/components/base/modal'
import Drawer from '@/app/components/base/drawer'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { usePluginReadme } from '@/service/use-plugins'
import cn from '@/utils/classnames'
import { RiBookReadLine, RiCloseLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
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

  if (!detail) return null

  const children = (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="bg-background-body px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <RiBookReadLine className="h-3 w-3 text-text-tertiary" />
            <span className="text-xs font-medium uppercase text-text-tertiary">
              {t('plugin.readmeInfo.title')}
            </span>
          </div>
          <ActionButton onClick={onClose}>
            <RiCloseLine className='h-4 w-4' />
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
                <p>{t('plugin.readmeInfo.failedToFetch')}</p>
              </div>
            )
          }

          if (readmeData?.readme) {
            return (
              <Markdown
                content={readmeData.readme}
                pluginInfo={{ plugin_unique_identifier: pluginUniqueIdentifier, plugin_id: detail.plugin_id }}
              />
            )
          }

          return (
            <div className="py-8 text-center text-text-tertiary">
              <p>{t('plugin.readmeInfo.noReadmeAvailable')}</p>
            </div>
          )
        })()}
      </div>
    </div>
  )

  return (
    showType === ReadmeShowType.drawer ? (
      <Drawer
        isOpen={!!detail}
        onClose={onClose}
        footer={null}
        positionCenter={false}
        showClose={false}
        panelClassName={cn(
          '!pointer-events-auto mb-2 ml-2 mt-16 !w-[600px] !max-w-[600px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl',
          '!z-[9999]',
        )}
        dialogClassName={cn('!pointer-events-none')}
        containerClassName='!justify-start'
        noOverlay
        clickOutsideNotOpen={true}
      >
        {children}
      </Drawer>
    ) : (
      <Modal
        isShow={!!detail}
        onClose={onClose}
        overlayOpacity={true}
        className='h-[calc(100vh-16px)] max-w-[800px] p-0'
        wrapperClassName='!z-[102]'
        containerClassName='p-2'
        clickOutsideNotClose={true}
      >
        {children}
      </Modal>
    )
  )
}

export default ReadmePanel
