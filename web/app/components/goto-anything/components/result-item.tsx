'use client'

import type { FC } from 'react'
import type { SearchResult } from '../actions/types'
import { Command } from 'cmdk'

export type ResultItemProps = {
  result: SearchResult
  onSelect: () => void
}

const ResultItem: FC<ResultItemProps> = ({ result, onSelect }) => {
  return (
    <Command.Item
      key={`${result.type}-${result.id}`}
      value={`${result.type}-${result.id}`}
      className="flex cursor-pointer items-center gap-3 rounded-md p-3 will-change-[background-color] hover:bg-state-base-hover aria-[selected=true]:bg-state-base-hover-alt data-[selected=true]:bg-state-base-hover-alt"
      onSelect={onSelect}
    >
      {result.icon}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text-secondary">
          {result.title}
        </div>
        {result.description && (
          <div className="mt-0.5 truncate text-xs text-text-quaternary">
            {result.description}
          </div>
        )}
      </div>
      <div className="text-xs capitalize text-text-quaternary">
        {result.type}
      </div>
    </Command.Item>
  )
}

export default ResultItem
