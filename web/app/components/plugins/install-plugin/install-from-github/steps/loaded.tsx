'use client'

import React from 'react'
import Button from '@/app/components/base/button'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useTranslation } from 'react-i18next'

type LoadedProps = {
  isLoading: boolean
  payload: PluginDeclaration
  onBack: () => void
  onInstall: () => void
}

const i18nPrefix = 'plugin.installModal'

const Loaded: React.FC<LoadedProps> = ({ isLoading, payload, onBack, onInstall }) => {
  const { t } = useTranslation()
  return (
    <>
      <div className='text-text-secondary system-md-regular'>
        <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
      </div>
      <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
        <Card
          className='w-full'
          payload={pluginManifestToCardPluginProps(payload)}
          titleLeft={<Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version}</Badge>}
        />
      </div>
      <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
        <Button
          variant='secondary'
          className='min-w-[72px]'
          onClick={onBack}
        >
          {t('plugin.installModal.back')}
        </Button>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={onInstall}
          disabled={isLoading}
        >
          {t('plugin.installModal.next')}
        </Button>
      </div>
    </>
  )
}

export default Loaded
