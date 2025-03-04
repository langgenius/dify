import type { BlockEnum } from '../types'
import cn from '@/utils/classnames'
import { initApoToolsEntry } from '../apo/constant'
import { useState } from 'react'
import type { ToolDefaultValue } from './types'
import { Popover } from 'antd'
import ApoToolsPreview from '../apo/tool-preview/apo-tools-preview'
import type { ApoToolTypeInfo } from '../apo/types'
type APOToolsProps = {
  searchText: string;
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const APOTools = ({ searchText, onSelect }: APOToolsProps) => {
  const [openKey, setOpenKey] = useState({
    select: false,
    analysis: false,
  })
  const hide = (key: ApoToolTypeInfo) => {
    setOpenKey(prev => ({
      ...prev,
      [key]: false,
    }))
  }

  const handleOpenChange = (key: ApoToolTypeInfo, newOpen: boolean) => {
    setOpenKey(prev => ({
      ...prev,
      [key]: newOpen,
    }))
  }
  return (
    <>
      <div className="mb-1 last-of-type:mb-0">
        {Object.entries(initApoToolsEntry).map(([key, tool]) => (
          <Popover
            key={key}
            placement='rightTop'
            trigger={['click']}
            open={openKey[key]}
            onOpenChange={newOpen => handleOpenChange(key, newOpen)}
            content={
              <ApoToolsPreview onSelect={onSelect} apoToolType={key} hidePopover={() => hide(key)}/>
            }
          >
            <div
              key={tool.type}
              className="flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer"
            >
              {/* <BlockIcon
                className="mr-2 shrink-0"
                type={BlockEnum.Tool}
                toolIcon={tool.icon}
              /> */}
              <div className={cn('grow text-sm text-gray-900 truncate')}>
                {tool.label}
              </div>
            </div>
          </Popover>
        ))}
      </div>
      {/* <AINodeRecommend
        onSelect={handleSelect}
        apoToolType={apoToolType}
        showRecommendModal={showRecommendModal}
        closeModal={() => {
          setApoToolType(null)
          setShowRecommendModal(false)
        }}
      /> */}
    </>
  )
}
export default APOTools
