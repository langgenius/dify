'use client'
import type { FC } from 'react'
import React from 'react'
import type { ThoughtItem, ToolInfoInThought } from '../type'
import Tool from '@/app/components/base/chat/chat/thought/tool'
import type { Emoji } from '@/app/components/tools/types'

export type IThoughtProps = {
  thought: ThoughtItem
  allToolIcons: Record<string, string | Emoji>
  isFinished: boolean
}

function getValue(value: string, isValueArray: boolean, index: number) {
  if (isValueArray) {
    try {
      return JSON.parse(value)[index]
    }
    catch (e) {
    }
  }
  return value
}

const Thought: FC<IThoughtProps> = ({
  thought,
  allToolIcons,
  isFinished,
}) => {
  const [toolNames, isValueArray]: [string[], boolean] = (() => {
    try {
      if (Array.isArray(JSON.parse(thought.tool)))
        return [JSON.parse(thought.tool), true]
    }
    catch (e) {
    }
    return [[thought.tool], false]
  })()

  const toolThoughtList = toolNames.map((toolName, index) => {
    return {
      name: toolName,
      label: thought.tool_labels?.toolName?.language ?? toolName,
      input: getValue(thought.tool_input, isValueArray, index),
      output: getValue(thought.observation, isValueArray, index),
      isFinished,
    }
  })

  return (
    <div className='my-2 space-y-2'>
      {toolThoughtList.map((item: ToolInfoInThought, index) => (
        <Tool
          key={index}
          payload={item}
          allToolIcons={allToolIcons}
        />
      ))}
    </div>
  )
}
export default React.memo(Thought)
