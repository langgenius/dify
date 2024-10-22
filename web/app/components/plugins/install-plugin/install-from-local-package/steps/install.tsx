'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { sleep } from '@/utils'
import { Trans, useTranslation } from 'react-i18next'

const i18nPrefix = 'plugin.installModal'

type Props = {
  payload: PluginDeclaration
  onCancel: () => void
  onInstalled: () => void
}

const Installed: FC<Props> = ({
  payload,
  onCancel,
  onInstalled,
}) => {
  const { t } = useTranslation()
  const [isInstalling, setIsInstalling] = React.useState(false)

  const handleInstall = async () => {
    if (isInstalling) return
    setIsInstalling(true)
    await sleep(1500)
    onInstalled()
  }

  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
          <p>
            <Trans
              i18nKey={`${i18nPrefix}.fromTrustSource`}
              components={{ trustSource: <span className='system-md-semibold' /> }}
            />
          </p>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={pluginManifestToCardPluginProps(payload)}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={onCancel}>
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px]'
          disabled={isInstalling}
          onClick={handleInstall}
        >
          {t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
