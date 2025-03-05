import { BlockEnum } from '../types'
import cn from '@/utils/classnames'
import { useEffect, useState } from 'react'
import type { ToolDefaultValue } from './types'
import { Popover } from 'antd'
import ApoToolsPreview from '../apo/tool-preview/apo-tools-preview'
import type { ApoToolTypeInfo } from '../apo/types'
import { fetchApoNode } from '@/service/tools'
import { useGetLanguage } from '@/context/i18n'
import BlockIcon from '../block-icon'
type APOToolsProps = {
  searchText: string;
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const APOTools = ({ searchText, onSelect }: APOToolsProps) => {
  const language = useGetLanguage()
  const [openKey, setOpenKey] = useState({
    apo_select: false,
    apo_analysis: false,
    apo_rule: false,
  })
  const [apoNodes, setApoNodes] = useState([])
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

  const getApoNodes = async () => {
    const data = await fetchApoNode()
    setApoNodes(data)
  }
  useEffect(() => {
    getApoNodes()
  }, [])
  return (
    <>
      <div className="mb-1 last-of-type:mb-0">
        {apoNodes?.map(node => (
          <Popover
            key={node.id}
            placement='rightTop'
            trigger={['click']}
            open={openKey[node.id]}
            onOpenChange={newOpen => handleOpenChange(node.id, newOpen)}
            content={
              <ApoToolsPreview onSelect={onSelect} apoToolType={node.name} hidePopover={() => hide(node.name)}/>
            }
          >
            <div
              key={node.id}
              className="flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer"
            >
              <BlockIcon
                className="mr-2 shrink-0"
                type={BlockEnum.Tool}
                toolIcon={node.icon}
              />
              <div className={cn('grow text-sm text-gray-900 truncate')}>
                {node?.label[language]}
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
