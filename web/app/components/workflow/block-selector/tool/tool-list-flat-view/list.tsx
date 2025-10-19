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
  indexBar: React.ReactNode
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  letters: string[]
  toolRefs: any
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
}

const ToolViewFlatView: FC<Props> = ({
  letters,
  payload,
  isShowLetterIndex,
  indexBar,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  toolRefs,
  selectedTools,
  canChooseMCPTool,
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
    <div className='flex w-full'>
      <div className='mr-1 grow'>
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
              hasSearchText={hasSearchText}
              onSelect={onSelect}
              canNotSelectMultiple={canNotSelectMultiple}
              onSelectMultiple={onSelectMultiple}
              selectedTools={selectedTools}
              canChooseMCPTool={canChooseMCPTool}
            />
          </div>
        ))}
      </div>
      {isShowLetterIndex && indexBar}
    </div>
  )
}

export default React.memo(ToolViewFlatView)
