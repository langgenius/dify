'use client'
import type { FC } from 'react'
import React from 'react'
import type { ThoughtItem, ToolThought } from '../type'
import Tool from '@/app/components/app/chat/thought/tool'
import type { Emoji } from '@/app/components/tools/types'

export type IThoughtProps = {
  list: ThoughtItem[]
  allToolIcons: Record<string, string | Emoji>
}

const Thought: FC<IThoughtProps> = ({
  list,
  allToolIcons,
}) => {
  const toolThoughtList = (() => {
    const tools: ToolThought[] = []
    list.forEach((item) => {
      const tool = tools.find(tool => tool.input.id === item.id)
      if (tool) {
        tool.output = item
        return
      }
      tools.push({ input: item })
    })
    return tools
  })()

  return (
    <div className='mb-2 space-y-2'>
      {toolThoughtList.map((item: ToolThought) => (
        <Tool
          key={item.input.id}
          payload={item}
          allToolIcons={allToolIcons}
        />
      ))}
    </div>
  )
}
export default React.memo(Thought)
