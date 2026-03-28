import * as React from 'react'
import { QAItemType } from './types'

type QAItemProps = {
  type: QAItemType
  text: string
}

const QAItem = (props: QAItemProps) => {
  const { type, text } = props
  return (
    <div className="inline-flex items-start justify-start gap-1 self-stretch">
      <div className="w-4 text-[13px] font-medium leading-5 text-text-tertiary">{type === QAItemType.Question ? 'Q' : 'A'}</div>
      <div className="body-md-regular flex-1 text-text-secondary">{text}</div>
    </div>
  )
}

export default React.memo(QAItem)
