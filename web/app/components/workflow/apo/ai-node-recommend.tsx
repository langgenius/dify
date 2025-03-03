import React, { useEffect, useState } from 'react'
import cn from '@/utils/classnames'
import { RiCloseLine } from '@remixicon/react'
import { fetchApoTools } from '@/service/tools'
import Conversation from './conversation'
import { initApoToolsEntry } from './constant'
import type { ApoToolTypeInfo } from './types'
import { ApoDisplayDataType } from './types'
import Input from '../../base/input'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from '../block-selector/types'
import { Portal } from '@headlessui/react'
type AINodeRecommendProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  apoToolType: ApoToolTypeInfo | null,
  showRecommendModal: boolean
  closeModal: () => void
}
const AINodeRecommend = ({
  onSelect,
  apoToolType,
  showRecommendModal,
  closeModal,
}: AINodeRecommendProps) => {
  const [conversation, setConversation] = useState<any[]>([])
  const [queryText, setQueryText] = useState('')
  const [loading, setLoading] = useState<boolean>(false)
  const getAllTools = async () => {
    const apoTools = await fetchApoTools(apoToolType, queryText)
    setConversation(prev => [
      ...prev,
      {
        role: 'ai',
        text: '以下是推荐的工具',
        data: apoTools[0],
        type: ApoDisplayDataType.tool,
      },
    ])
    setQueryText('')
    setLoading(false)
  }
  useEffect(() => {
    if(apoToolType && showRecommendModal) {
      setConversation([
        {
          role: 'human',
          text: `请给出${initApoToolsEntry[apoToolType].label}推荐工具`,
        },
      ])
      getAllTools()
    }
  }, [apoToolType, showRecommendModal])

  const handleKeyDown = async (event) => {
    if (event.key === 'Enter' && !loading) {
      setLoading(true)
      setConversation(prev => [
        ...prev,
        {
          role: 'human',
          text: queryText,
        },
      ])
      getAllTools()
    }
  }
  return showRecommendModal
    && <Portal><div className={cn('flex flex-col z-[10000] fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2  bg-components-panel-bg shadow-lg border-[0.5px] border-components-panel-border rounded-2xl overflow-y-auto w-1/2 h-3/4')}>
      {/* header */}
      <div className='flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
        节点推荐
        <div className='p-1 cursor-pointer' onClick={() => closeModal()}>
          <RiCloseLine className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      <div className='flex-1 h-0 flex flex-col overflow-hidden'>
        <div className='flex-1 overflow-auto'>
          <Conversation conversation={conversation} onSelect={onSelect} closeModal={closeModal} />

        </div>
        <div className='grow-0 shrink-0 flex items-center justify-center p-4'>
          <Input
            showClearIcon
            wrapperClassName='w-full'
            value={queryText}
            onChange={e => setQueryText(e.target.value)}
            onClear={() => setQueryText('')}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        </div>
      </div>

    </div></Portal>
}
export default React.memo(AINodeRecommend)
