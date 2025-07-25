'use client'
import { RiEditLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { Variable02 } from '../../../icons/src/vender/solid/development'

type Props = {
  type: 'edit' | 'variable'
  text: string
}

const TagLabel: FC<Props> = ({
  type,
  text,
}) => {
  const Icon = type === 'edit' ? RiEditLine : Variable02
  return (
    <div className='flex h-5 items-center space-x-1 rounded-md bg-components-button-secondary-bg px-1 text-text-accent'>
      <Icon className='size-3.5' />
      <div className='system-xs-medium '>{text}</div>
    </div>
  )
}
export default React.memo(TagLabel)
