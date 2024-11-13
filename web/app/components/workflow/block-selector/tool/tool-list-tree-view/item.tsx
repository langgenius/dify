'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import type { ToolWithProvider } from '../../../types'
import Tool from '../tool'
import type { BlockEnum } from '../../../types'
import { ViewType } from '../../view-type-select'
import type { ToolDefaultValue } from '../../types'

type Props = {
  groupName: string
  toolList: ToolWithProvider[]
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const Item: FC<Props> = ({
  groupName,
  toolList,
  hasSearchText,
  onSelect,
}) => {
  const [fold, setFold] = React.useState<boolean>(true)
  useEffect(() => {
    if (hasSearchText && fold) {
      setFold(false)
      return
    }
    if (!hasSearchText && !fold)
      setFold(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSearchText])
  return (
    <div>
      <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>
        {groupName}
      </div>
      <div>
        {toolList.map((tool: ToolWithProvider) => (
          <Tool
            key={tool.id}
            payload={tool}
            viewType={ViewType.tree}
            isShowLetterIndex={false}
            isFold={fold}
            onFoldChange={setFold}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

export default React.memo(Item)
