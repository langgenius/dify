'use client'

import React from 'react'
import { RiLoader2Line } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

type InstallFromLocalPackageProps = {
  file: File
  onClose: () => void
}

const InstallFromLocalPackage: React.FC<InstallFromLocalPackageProps> = ({ onClose }) => {
  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] p-0 flex-col items-start rounded-2xl border-[0.5px]
        border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          Install plugin
        </div>
      </div>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='flex items-center gap-1 self-stretch'>
          <RiLoader2Line className='text-text-accent w-4 h-4' />
          <div className='text-text-secondary system-md-regular'>
            Uploading notion-sync.difypkg ...
          </div>
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
          disabled
        >
          Install
        </Button>
      </div>
    </Modal>
  )
}

export default InstallFromLocalPackage
