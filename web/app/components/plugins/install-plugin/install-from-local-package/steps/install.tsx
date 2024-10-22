'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import { pluginManifestToCardPluginProps } from '../../utils'
import Button from '@/app/components/base/button'
import { sleep } from '@/utils'

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
          <p>About to install the following plugin.</p>
          <p>Please make sure that you only install plugins from a <span className='system-md-semibold'>trusted source</span>.</p>
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
            Cancel
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px]'
          disabled={isInstalling}
          onClick={handleInstall}
        >
          {isInstalling ? 'Installing...' : 'Install'}
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
