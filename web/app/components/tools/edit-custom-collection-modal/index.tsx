'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  payload: any
  onHide: () => void
}
// Add and Edit
const EditCustomCollectionModal: FC<Props> = ({
  payload,
}) => {
  const isAdd = !!payload

  return (
    <div>
    </div>
  )
}
export default React.memo(EditCustomCollectionModal)
