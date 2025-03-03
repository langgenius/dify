import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import cn from '@/utils/classnames'
import { initApoToolsEntry } from '../apo/constant'
import AINodeRecommend from '@/app/components/workflow/apo/ai-node-recommend'
import { useState } from 'react'
import type { ToolDefaultValue } from './types'
type APOToolsProps = {
  searchText: string;
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const APOTools = ({ searchText, onSelect }: APOToolsProps) => {
  const [apoToolType, setApoToolType] = useState()
  const [showRecommendModal, setShowRecommendModal] = useState()
  const handleSelect = (type: BlockEnum) => {
    onSelect(type)
    setShowRecommendModal(false)
  }
  return (
    <>
      <div className="mb-1 last-of-type:mb-0">
        {Object.entries(initApoToolsEntry).map(([key, tool]) => (
          <Tooltip
            key={key}
            position="right"
            popupClassName="w-[200px]"
            popupContent={
              <div>
                <BlockIcon
                  size="md"
                  className="mb-2"
                  type={BlockEnum.Tool}
                  toolIcon={tool.icon}
                />
                <div className={cn('grow text-sm text-gray-900 truncate')}>
                  {tool.label}
                </div>
                <div className="text-xs text-gray-700 leading-[18px]">
                  {tool.description}
                </div>
                {/* <div className={cn('grow text-sm text-gray-900 truncate')}>{tool.label[language]}</div>
                <div className='text-xs text-gray-700 leading-[18px]'>{tool.description[language]}</div> */}
              </div>
            }
          >
            <div
              key={tool.type}
              className="flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer"
              onClick={() => {
                setApoToolType(tool.type)
                setShowRecommendModal(true)
              }}
            >
              <BlockIcon
                className="mr-2 shrink-0"
                type={BlockEnum.Tool}
                toolIcon={tool.icon}
              />
              <div className={cn('grow text-sm text-gray-900 truncate')}>
                {tool.label}
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
      <AINodeRecommend
        onSelect={handleSelect}
        apoToolType={apoToolType}
        showRecommendModal={showRecommendModal}
        closeModal={() => {
          setApoToolType(null)
          setShowRecommendModal(false)
        }}
      />
    </>
  )
}
export default APOTools
