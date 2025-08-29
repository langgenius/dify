'use client'
import React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookReadLine, RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Drawer from '@/app/components/base/drawer'
import { Markdown } from '@/app/components/base/markdown'
import { usePluginReadme } from '@/service/use-plugins'
// import type { PluginDetail } from '@/app/components/plugins/types'
import Loading from '@/app/components/base/loading'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import PluginTitleInfo from '@/app/components/plugins/plugin-title-info'
import Modal from '@/app/components/base/modal'
import ActionButton from '@/app/components/base/action-button'
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

        <PluginTitleInfo detail={detail} size="large" />
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
                <p>{t('plugin.readmeInfo.noReadmeAvailable')}</p>
              </div>
            )
          }

          if (readmeData?.readme) {
            return (
              <Markdown
                content={readmeData.readme}
                className="prose-sm prose max-w-none"
                pluginUniqueIdentifier={pluginUniqueIdentifier}
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
          'mb-2 ml-2 mt-16 !w-[600px] !max-w-[600px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl',
          '!z-[9999]',
        )}
        dialogClassName={cn('!z-[9998]')}
        containerClassName='!justify-start'
        noOverlay
        clickOutsideNotOpen={false}
      >
        {children}
      </Drawer>
    ) : (
      <Modal
        isShow={!!detail}
        onClose={onClose}
        overlayOpacity={true}
        className='h-[calc(100vh-16px)] max-w-[800px] p-0'
        wrapperClassName='!z-[10000]'
        containerClassName='p-2'
        clickOutsideNotClose={true}
      >
        {children}
      </Modal>
    )
  )
}

export default ReadmePanel
