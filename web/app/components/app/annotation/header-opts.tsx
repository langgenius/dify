'use client'
import type { FC } from 'react'
import React from 'react'
import Button from '../../base/button'

type Props = {
  onAdd: () => void
  onExport: () => void
  onClearAll: () => void
}

const HeaderOptions: FC<Props> = ({
  onAdd,
  onExport,
  onClearAll,
}) => {
  return (
    <div className='flex'>
      <Button type='primary' onClick={onAdd}>Add</Button>
      <div onClick={onExport}>Export </div>
      <div onClick={onClearAll}>Clear</div>
    </div>
  )
}
export default React.memo(HeaderOptions)
