'use client'
import type { FC, ReactNode } from 'react'
import * as React from 'react'

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
      <div className="flex flex-col gap-y-0.5 rounded-md bg-workflow-block-parma-bg px-[5px] py-[3px]">
        <div className="system-2xs-semibold-uppercase text-text-secondary uppercase">
          {title}
        </div>
        <div className="system-xs-regular wrap-break-word text-text-tertiary">
          {content}
        </div>
      </div>
    </div>
  )
}
export default React.memo(InfoPanel)
