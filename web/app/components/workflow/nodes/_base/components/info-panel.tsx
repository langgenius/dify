'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  title: string
  content: string | JSX.Element
}

const InfoPanel: FC<Props> = ({
  title,
  content,
}) => {
  return (
    <div>
      <div className='px-[5px] py-[3px] bg-workflow-block-parma-bg rounded-md'>
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
