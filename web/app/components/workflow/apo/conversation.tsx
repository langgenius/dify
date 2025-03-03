import React from 'react'
import cn from '@/utils/classnames'
import { Markdown } from '@/app/components/base/markdown'
import { ApoDisplayDataType } from './types'
import RecommendTools from './recommend-tools'
import type { ToolDefaultValue } from '../block-selector/types'
import type { BlockEnum } from '../types'

type ConversationProps = {
  conversation: any[]
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  closeModal: () => void

}
const Conversation = ({ conversation, onSelect, closeModal }: ConversationProps) => {
  return <div className='p-2'>{
    conversation?.map((con, index) => (
      <div key={index} className={cn('relative flex ', con.role === 'human' ? 'justify-end' : '')}>

        <div className={cn('rounded  p-2 max-w-[80%]')} style={{ backgroundColor: 'rgba(0, 0, 0, 0.04)', color: 'rgba(0, 0, 0, 0.85)' }}>
          <Markdown content={con.text} />
          {/* data */}
          <div>
            {
              con.type === ApoDisplayDataType.tool && con.data && <>
                <RecommendTools provider={con.data} onSelect={onSelect} closeModal={closeModal}/>
              </>
            }
          </div>
        </div>

        {/* data */}
        {/* <div>
          {
            con.type === ApoDisplayDataType.tool && <>

            </>
          }
        </div> */}
      </div>
    ))
  }</div>
}
export default React.memo(Conversation)
