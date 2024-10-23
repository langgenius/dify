'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import Button from '@/app/components/base/button'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useTranslation } from 'react-i18next'

type Props = {
  payload: PluginDeclaration
  isFailed: boolean
  onCancel: () => void
}

const Installed: FC<Props> = ({
  payload,
  isFailed,
  onCancel,
}) => {
  const { t } = useTranslation()
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <p className='text-text-secondary system-md-regular'>{t(`plugin.installModal.${isFailed ? 'installFailedDesc' : 'installedSuccessfullyDesc'}`)}</p>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={pluginManifestToCardPluginProps(payload)}
            installed={!isFailed}
            installFailed={isFailed}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        <Button
          variant='primary'
          className='min-w-[72px]'
          onClick={onCancel}
        >
          {t('common.operation.close')}
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
