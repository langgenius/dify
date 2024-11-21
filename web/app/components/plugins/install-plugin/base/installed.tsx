'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Card from '../../card'
import Button from '@/app/components/base/button'
import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { pluginManifestInMarketToPluginProps, pluginManifestToCardPluginProps } from '../utils'
import Badge, { BadgeState } from '@/app/components/base/badge/index'

type Props = {
  payload?: Plugin | PluginDeclaration | PluginManifestInMarket | null
  isMarketPayload?: boolean
  isFailed: boolean
  errMsg?: string | null
  onCancel: () => void
}

const Installed: FC<Props> = ({
  payload,
  isMarketPayload,
  isFailed,
  errMsg,
  onCancel,
}) => {
  const { t } = useTranslation()

  const handleClose = () => {
    onCancel()
  }
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <p className='text-text-secondary system-md-regular'>{(isFailed && errMsg) ? errMsg : t(`plugin.installModal.${isFailed ? 'installFailedDesc' : 'installedSuccessfullyDesc'}`)}</p>
        {payload && (
          <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
            <Card
              className='w-full'
              payload={isMarketPayload ? pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket) : pluginManifestToCardPluginProps(payload as PluginDeclaration)}
              installed={!isFailed}
              installFailed={isFailed}
              titleLeft={<Badge className='mx-1' size="s" state={BadgeState.Default}>{(payload as PluginDeclaration).version || (payload as PluginManifestInMarket).latest_version}</Badge>}
            />
          </div>
        )}
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={handleClose}
        >
          {t('common.operation.close')}
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
