'use client'
import type { FC } from 'react'
import type { ThoughtItem, ToolInfoInThought } from '../type'
import * as React from 'react'
import { useLocale } from '#i18n'
import ToolDetail from '@/app/components/base/chat/chat/answer/tool-detail'
import { getPluginLanguage, renderI18nObject } from '@/i18n/metadata'

type IThoughtProps = {
  thought: ThoughtItem
  isFinished: boolean
}

function getValue(value: string, isValueArray: boolean, index: number) {
  if (isValueArray) {
    try {
      return JSON.parse(value)[index]
    } catch {}
  }
  return value
}

const Thought: FC<IThoughtProps> = ({ thought, isFinished }) => {
  const language = getPluginLanguage(useLocale())
  const [toolNames, isValueArray]: [string[], boolean] = (() => {
    try {
      if (Array.isArray(JSON.parse(thought.tool))) return [JSON.parse(thought.tool), true]
    } catch {}
    return [[thought.tool], false]
  })()

  const toolThoughtList = toolNames.map((toolName, index) => {
    return {
      name: toolName,
      label: renderI18nObject(thought.tool_labels?.[toolName] ?? {}, language) || toolName,
      input: getValue(thought.tool_input, isValueArray, index),
      output: getValue(thought.observation, isValueArray, index),
      isFinished,
    }
  })

  return (
    <div className="my-2 space-y-2">
      {toolThoughtList.map((item: ToolInfoInThought, index) => (
        <ToolDetail key={index} payload={item} />
      ))}
    </div>
  )
}
export default React.memo(Thought)
