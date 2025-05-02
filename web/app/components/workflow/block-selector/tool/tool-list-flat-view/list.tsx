'use client'
import type { FC } from 'react'
import React from 'react'
import type { ToolWithProvider } from '../../../types'
import type { BlockEnum } from '../../../types'
import type { ToolDefaultValue, ToolValue } from '../../types'
import Tool from '../tool'
import { ViewType } from '../../view-type-select'
import { useMemo } from 'react'

type Props = {
  payload: ToolWithProvider[]
  isShowLetterIndex: boolean
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  letters: string[]
  toolRefs: any
  selectedTools?: ToolValue[]
}

const ToolViewFlatView: FC<Props> = ({
  letters,
  payload,
  isShowLetterIndex,
  hasSearchText,
  onSelect,
  toolRefs,
  selectedTools,
}) => {
  const firstLetterToolIds = useMemo(() => {
    const res: Record<string, string> = {}
    letters.forEach((letter) => {
      const firstToolId = payload.find(tool => tool.letter === letter)?.id
      if (firstToolId)
        res[firstToolId] = letter
    })
    return res
  }, [payload, letters])
  return (
    <div>
      {payload.map(tool => (
        <div
          key={tool.id}
          ref={(el) => {
            const letter = firstLetterToolIds[tool.id]
            if (letter)
              toolRefs.current[letter] = el
          }}
        >
          <Tool
            payload={tool}
            viewType={ViewType.flat}
            isShowLetterIndex={isShowLetterIndex}
            hasSearchText={hasSearchText}
            onSelect={onSelect}
            selectedTools={selectedTools}
          />
        </div>
      ))}
    </div>
  )
}

export default React.memo(ToolViewFlatView)
