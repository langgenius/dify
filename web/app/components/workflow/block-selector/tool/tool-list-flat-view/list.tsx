'use client'
import type { FC, RefObject } from 'react'
import type { BlockEnum, ToolWithProvider } from '../../../types'
import type { ToolDefaultValue, ToolValue } from '../../types'
import type { ToolActionPreviewCardHandle } from '../action-item'
import * as React from 'react'
import { useMemo } from 'react'
import { ViewType } from '../../view-type-select'
import Tool from '../tool'

type Props = {
  payload: ToolWithProvider[]
  previewCardHandle: ToolActionPreviewCardHandle
  isShowLetterIndex: boolean
  indexBar: React.ReactNode
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  letters: string[]
  toolRefs: RefObject<Record<string, HTMLDivElement | null>>
  selectedTools?: ToolValue[]
}

const ToolViewFlatView: FC<Props> = ({
  letters,
  payload,
  previewCardHandle,
  isShowLetterIndex,
  indexBar,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
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
    <div className="flex w-full">
      <div className="mr-1 grow">
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
              previewCardHandle={previewCardHandle}
              viewType={ViewType.flat}
              hasSearchText={hasSearchText}
              onSelect={onSelect}
              canNotSelectMultiple={canNotSelectMultiple}
              onSelectMultiple={onSelectMultiple}
              selectedTools={selectedTools}
            />
          </div>
        ))}
      </div>
      {isShowLetterIndex && indexBar}
    </div>
  )
}

export default React.memo(ToolViewFlatView)
