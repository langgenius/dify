'use client'

import type { FC } from 'react'
import { useState } from 'react'
import Modal from '@/app/components/base/modal'
import { useKeyPress } from 'ahooks'
type Props = {
  onHide?: () => void
}

const GotoAnything: FC<Props> = ({
  onHide,
}) => {
  const [show, setShow] = useState(false)
  // Handle key press for opening the modal
  useKeyPress(['cmd', 'g'], (e) => {
    e.preventDefault()
    setShow(!show)
  })
  return (
    <Modal
      isShow={show}
      onClose={onHide}
      closable
      className='w-[480px] !p-0'
    >
      <div className='shadows-shadow-xl flex w-[480px] flex-col items-start rounded-2xl border border-components-panel-border bg-components-panel-bg'>
        <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
          <span className='title-2xl-semi-bold self-stretch text-text-primary'>Goto Anything</span>
        </div>
        <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
          {/* Content goes here */}
        </div>
      </div>
    </Modal>
  )
}

export default GotoAnything
