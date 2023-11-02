'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useClickAway } from 'ahooks'

type Props = {
  isShow: boolean
  onHide: () => void
  onSave: () => void
}

const ModifyRetrievalModal: FC<Props> = ({
  isShow,
  onHide,
  onSave,
}) => {
  const ref = useRef(null)

  useClickAway(() => {
    if (ref)
      onHide()
  }, ref)

  if (!isShow)
    return null

  return (
    <div
      className='fixed top-16 right-2 bottom-2 flex flex-col bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl z-10'
      style={{ width: 600 }}
      ref={ref}
    >
      111
    </div>
  )
}
export default React.memo(ModifyRetrievalModal)
