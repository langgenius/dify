'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'

type Props = {
  title: string
  content: ReactNode
}

const InfoPanel: FC<Props> = ({
  title,
  content,
}) => {
  return (
    <div>
      <div className='flex flex-col gap-y-0.5 px-[5px] py-[3px] bg-workflow-block-parma-bg rounded-md'>
        <div className='text-text-secondary system-2xs-semibold-uppercase uppercase'>
          {title}
        </div>
        <div className='text-text-tertiary system-xs-regular break-words'>
          {content}
        </div>
      </div>
    </div>
  )
}
export default React.memo(InfoPanel)
