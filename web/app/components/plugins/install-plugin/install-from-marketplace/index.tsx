'use client'

import React from 'react'
import { useContext } from 'use-context-selector'
import Card from '../../card'
import { extensionDallE, modelGPT4, toolNotion } from '../../card/card-mock'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import I18n from '@/context/i18n'

type InstallFromMarketplaceProps = {
  onClose: () => void
}

const InstallFromMarketplace: React.FC<InstallFromMarketplaceProps> = ({ onClose }) => {
  const { locale } = useContext(I18n)

  // Mock a plugin list
  const plugins = [toolNotion, extensionDallE, modelGPT4]

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] flex-col items-start p-0 rounded-2xl border-[0.5px]
        border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>Install plugin</div>
      </div>
      <div className='flex px-6 py-3 flex-col justify-center items-start gap-4 self-stretch'>
        <div className='flex flex-col items-start gap-2 self-stretch'>
          <div className='text-text-secondary system-md-regular'>About to install the following plugin</div>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap
          rounded-2xl bg-background-section-burn'>
          {plugins.map((plugin, index) => (
            <Card
              key={index}
              payload={plugin as any}
              locale={locale}
            />
          ))}
        </div>
      </div>
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        <Button
          variant='secondary'
          className='min-w-[72px]'
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant='primary'
          className='min-w-[72px]'
        >
          Install
        </Button>
      </div>
    </Modal>
  )
}

export default InstallFromMarketplace
