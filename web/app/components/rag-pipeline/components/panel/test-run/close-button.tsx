import React from 'react'
import { RiCloseLine } from '@remixicon/react'

type CloseButtonProps = {
  handleClose: () => void
}

const CloseButton = ({
  handleClose,
}: CloseButtonProps) => {
  return (
    <button
      type='button'
      className='absolute right-2.5 top-2.5 flex size-8 items-center justify-center p-1.5'
      onClick={handleClose}
    >
      <RiCloseLine className='size-4 text-text-tertiary' />
    </button>
  )
}

export default React.memo(CloseButton)
