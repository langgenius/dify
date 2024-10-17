'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import { RiLoader2Line } from '@remixicon/react'
import Card from '../../card'
import { toolNotion } from '../../card/card-mock'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import I18n from '@/context/i18n'

type InstallFromLocalPackageProps = {
  file: File
  onClose: () => void
}

const InstallFromLocalPackage: React.FC<InstallFromLocalPackageProps> = ({ onClose }) => {
  const [status, setStatus] = useState<'uploading' | 'ready' | 'installing' | 'installed'>('uploading')
  const { locale } = useContext(I18n)

  useEffect(() => {
    const timer = setTimeout(() => setStatus('ready'), 1500)
    return () => clearTimeout(timer)
  }, [])

  const handleInstall = useCallback(async () => {
    setStatus('installing')
    await new Promise(resolve => setTimeout(resolve, 1000))
    setStatus('installed')
  }, [])

  const renderStatusMessage = () => {
    switch (status) {
      case 'uploading':
        return (
          <div className='flex items-center gap-1 self-stretch'>
            <RiLoader2Line className='text-text-accent w-4 h-4' />
            <div className='text-text-secondary system-md-regular'>
              Uploading notion-sync.difypkg ...
            </div>
          </div>
        )
      case 'installed':
        return <p className='text-text-secondary system-md-regular'>The plugin has been installed successfully.</p>
      default:
        return (
          <div className='text-text-secondary system-md-regular'>
            <p>About to install the following plugin.</p>
            <p>Please make sure that you only install plugins from a <span className='system-md-semibold'>trusted source</span>.</p>
          </div>
        )
    }
  }

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] p-0 flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          Install plugin
        </div>
      </div>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        {renderStatusMessage()}
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          <Card
            className='w-full'
            payload={status === 'uploading' ? { name: 'notion-sync' } as any : toolNotion as any}
            isLoading={status === 'uploading'}
            loadingFileName='notion-sync.difypkg'
            installed={status === 'installed'}
          />
        </div>
      </div>
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {status === 'installed'
          ? (
            <Button variant='primary' onClick={onClose}>Close</Button>
          )
          : (
            <>
              <Button variant='secondary' className='min-w-[72px]' onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant='primary'
                className='min-w-[72px]'
                disabled={status !== 'ready'}
                onClick={handleInstall}
              >
                {status === 'installing' ? 'Installing...' : 'Install'}
              </Button>
            </>
          )}
      </div>
    </Modal>
  )
}

export default InstallFromLocalPackage
