'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiLoopLeftLine,
} from '@remixicon/react'
import {
  Mcp,
} from '@/app/components/base/icons/src/vender/other'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { asyncRunSafe } from '@/utils'
import { basePath } from '@/utils/var'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Confirm from '@/app/components/base/confirm'
import type { AppDetailResponse } from '@/models/app'
import { useAppContext } from '@/context/app-context'
import type { AppSSO } from '@/types/app'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'

export type IAppCardProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
  onGenerateCode?: () => Promise<void>
}

function MCPServiceCard({
  appInfo,
  onGenerateCode,
}: IAppCardProps) {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const toggleDisabled = !isCurrentWorkspaceEditor
  const runningStatus = appInfo.enable_site // TODO
  const { app_base_url, access_token } = appInfo.site ?? {}
  const appMode = (appInfo.mode !== 'completion' && appInfo.mode !== 'workflow') ? 'chat' : appInfo.mode
  const appUrl = `${app_base_url}${basePath}/${appMode}/${access_token}`

  const onGenCode = async () => {
    if (onGenerateCode) {
      setGenLoading(true)
      await asyncRunSafe(onGenerateCode())
      setGenLoading(false)
    }
  }

  const onChangeStatus = async (status: boolean) => {
    // TODO
  }

  return (
    <div className={cn('w-full max-w-full rounded-xl border-l-[0.5px] border-t border-effects-highlight')}>
      <div className='rounded-xl bg-background-default'>
        <div className='flex w-full flex-col items-start justify-center gap-3 self-stretch border-b-[0.5px] border-divider-subtle p-3'>
          <div className='flex w-full items-center gap-3 self-stretch'>
            <div className='flex grow items-center'>
              <div className='mr-3 shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-500 p-1 shadow-md'>
                <Mcp className='h-4 w-4 text-text-primary-on-surface' />
              </div>
              <div className="group w-full">
                <div className="min-w-0 overflow-hidden text-ellipsis break-normal">
                  {t('tools.mcp.server.title')}
                </div>
              </div>
            </div>
            <div className='flex items-center gap-1'>
              <Indicator color={runningStatus ? 'green' : 'yellow'} />
              <div className={`${runningStatus ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                {runningStatus
                  ? t('appOverview.overview.status.running')
                  : t('appOverview.overview.status.disable')}
              </div>
            </div>
            <Switch defaultValue={runningStatus} onChange={onChangeStatus} disabled={toggleDisabled} />
          </div>
          <div className='flex flex-col items-start justify-center self-stretch'>
            <div className="system-xs-medium pb-1 text-text-tertiary">
              {t('tools.mcp.server.url')}
            </div>
            <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
              <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
                  {appUrl}
                </div>
              </div>
              <CopyFeedback
                content={appUrl}
                className={'!size-6'}
              />
              <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />
              {/* button copy link/ button regenerate */}
              {showConfirmDelete && (
                <Confirm
                  type='warning'
                  title={t('appOverview.overview.appInfo.regenerate')}
                  content={t('tools.mcp.server.reGen')}
                  isShow={showConfirmDelete}
                  onConfirm={() => {
                    onGenCode()
                    setShowConfirmDelete(false)
                  }}
                  onCancel={() => setShowConfirmDelete(false)}
                />
              )}
              {isCurrentWorkspaceManager && (
                <Tooltip
                  popupContent={t('appOverview.overview.appInfo.regenerate') || ''}
                >
                  <div
                    className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
                    onClick={() => setShowConfirmDelete(true)}
                  >
                    <RiLoopLeftLine className={cn('h-4 w-4 text-text-tertiary hover:text-text-secondary', genLoading && 'animate-spin')}/>
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className='flex items-center gap-1 self-stretch p-3'>
          <Button size='small' variant='ghost'>{t('tools.mcp.server.addDescription')}</Button>
        </div>
      </div>
    </div>
  )
}

export default MCPServiceCard
