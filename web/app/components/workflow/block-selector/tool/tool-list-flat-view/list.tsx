'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import type { ToolWithProvider } from '../../../types'
import type { BlockEnum } from '../../../types'
import type { ToolDefaultValue } from '../../types'
import Tool from '../tool'
import { ViewType } from '../../view-type-select'

type Props = {
  payload: ToolWithProvider[]
  isShowLetterIndex: boolean
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolViewFlatView: FC<Props> = ({
  payload,
  isShowLetterIndex,
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
      {payload.map(tool => (
        <Tool
          key={tool.id}
          payload={tool}
          viewType={ViewType.flat}
          isShowLetterIndex={isShowLetterIndex}
          isFold={fold}
          onFoldChange={setFold}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolViewFlatView)
