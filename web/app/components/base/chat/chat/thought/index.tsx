'use client'
import type { FC } from 'react'
import React from 'react'
import type { ThoughtItem, ToolInfoInThought } from '../type'
import ToolDetail from '@/app/components/base/chat/chat/answer/tool-detail'

export type IThoughtProps = {
  thought: ThoughtItem
  isFinished: boolean
}

function getValue(value: string, isValueArray: boolean, index: number) {
  if (isValueArray) {
    try {
      return JSON.parse(value)[index]
    }
    catch {
    }
  }
  return value
}

const Thought: FC<IThoughtProps> = ({
  thought,
  isFinished,
}) => {
  const [toolNames, isValueArray]: [string[], boolean] = (() => {
    try {
      if (Array.isArray(JSON.parse(thought.tool)))
        return [JSON.parse(thought.tool), true]
    }
    catch {
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
        <ToolDetail
          key={index}
          payload={item}
        />
      ))}
    </div>
  )
}
export default React.memo(Thought)
