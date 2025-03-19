import type { ToolWithProvider } from '../types'
import { BlockEnum } from '../types'
import cn from '@/utils/classnames'
import { useMemo, useState } from 'react'
import type { ToolDefaultValue } from './types'
import { Popover } from 'antd'
import ApoToolsPreview from '../apo/tool-preview/apo-tools-preview'
import type { ApoToolTypeInfo } from '../apo/types'
import { useGetLanguage } from '@/context/i18n'
import BlockIcon from '../block-icon'

type APOToolsProps = {
  searchText: string;
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void;
  apoNodes?: ToolWithProvider[]
}

const APOTools = ({ searchText, onSelect, apoNodes = [] }: APOToolsProps) => {
  const language = useGetLanguage()
  const [openKey, setOpenKey] = useState<Record<string, boolean>>({})

  const filteredApoNodes = useMemo(() => {
    const lowerCaseSearch = searchText.toLowerCase()
    return apoNodes.filter(node => node.label[language]?.toLowerCase().includes(lowerCaseSearch))
  }, [searchText, apoNodes, language])

  const handleOpenChange = (key: ApoToolTypeInfo, newOpen: boolean) => {
    setOpenKey(prev => ({ ...prev, [key]: newOpen }))
  }

  const hide = (key: ApoToolTypeInfo) => {
    setOpenKey(prev => ({ ...prev, [key]: false }))
  }

  return (
    <div className="mb-1 last-of-type:mb-0">
      {filteredApoNodes.map(node => (
        <Popover
          key={node.id}
          placement='rightTop'
          trigger={['click']}
          open={openKey[node.id]}
          onOpenChange={newOpen => handleOpenChange(node.id, newOpen)}
          content={
            <ApoToolsPreview onSelect={onSelect} apoToolType={node.name} hidePopover={() => hide(node.name)} />
          }
        >
          <div className="flex items-center px-3 w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer">
            <BlockIcon size="md" className="mr-2 shrink-0" type={BlockEnum.Tool} toolIcon={node.icon} />
            <div className={cn('grow text-sm text-gray-900 truncate')}>{node.label[language]}</div>
          </div>
        </Popover>
      ))}
    </div>
  )
}

export default APOTools
