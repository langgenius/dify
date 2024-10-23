'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { RiInformation2Line } from '@remixicon/react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { sleep } from '@/utils'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import Badge, { BadgeState } from '@/app/components/base/badge/index'

const i18nPrefix = 'plugin.installModal'

type Props = {
  payload: PluginDeclaration
  onCancel: () => void
  onInstalled: () => void
  onFailed: () => void
}

const Installed: FC<Props> = ({
  payload,
  onCancel,
  onInstalled,
  onFailed,
}) => {
  const { t } = useTranslation()
  const [isInstalling, setIsInstalling] = React.useState(false)

  const handleInstall = async () => {
    if (isInstalling) return
    setIsInstalling(true)
    await sleep(1500)
    onInstalled()
    // onFailed()
  }

  const toInstallVersion = '1.3.0'
  const supportCheckInstalled = false // TODO: check installed in beta version.

  const versionInfo = useMemo(() => {
    return (<>{
      payload.version === toInstallVersion || !supportCheckInstalled
        ? (
          <Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version}</Badge>
        )
        : (
          <>
            <Badge className='mx-1' size="s" state={BadgeState.Warning}>
              {`${payload.version} -> ${toInstallVersion}`}
            </Badge>
            <div className='flex px-0.5 justify-center items-center gap-0.5'>
              <div className='text-text-warning system-xs-medium'>Used in 3 apps</div>
              <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
            </div>
          </>
        )
    }</>)
  }, [payload])

  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.readyToInstall`)}</p>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={pluginManifestToCardPluginProps(payload)}
            titleLeft={versionInfo}
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
          className='min-w-[72px] flex space-x-0.5'
          disabled={isInstalling}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
