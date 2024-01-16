'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { ThoughtItem, ToolThought } from '../type'
import s from './style.module.css'
import { DataSet as DataSetIcon, Loading as LodingIcon, Search, ThoughtList, WebReader } from '@/app/components/base/icons/src/public/thought'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import type { DataSet } from '@/models/datasets'

export type IThoughtProps = {
  list: ThoughtItem[]
  isThinking?: boolean
  dataSets?: DataSet[]
}

const getIcon = (toolId: string) => {
  switch (toolId) {
    case 'dataset':
      return <DataSetIcon />
    case 'web_reader':
      return <WebReader />
    default:
      return <Search />
  }
}

const Thought: FC<IThoughtProps> = ({
  list,
  isThinking,
  dataSets,
}) => {
  const { t } = useTranslation()
  const [isShowDetail, setIsShowDetail] = React.useState(false)

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
  console.log(toolThoughtList)
  const getThoughtText = (item: ThoughtItem) => {
    try {
      const input = JSON.parse(item.tool_input)
      // dataset
      if (item.tool.startsWith('dataset-')) {
        const dataSetId = item.tool.replace('dataset-', '')
        const datasetName = dataSets?.find(item => item.id === dataSetId)?.name || 'unknown dataset'
        return t('explore.universalChat.thought.res.dataset').replace('{datasetName}', `<span class="text-gray-700">${datasetName}</span>`)
      }
      switch (item.tool) {
        case 'web_reader':
          return t(`explore.universalChat.thought.res.webReader.${!input.cursor ? 'normal' : 'hasPageInfo'}`).replace('{url}', `<a href="${input.url}" class="text-[#155EEF]">${input.url}</a>`)
        case 'google_search':
          return t('explore.universalChat.thought.res.google', { query: input.query })
        case 'wikipedia':
          return t('explore.universalChat.thought.res.wikipedia', { query: input.query })
        case 'current_datetime':
          return t('explore.universalChat.thought.res.date')
        default:
          return `Unknown tool: ${item.tool}`
      }
    }
    catch (error) {
      console.error(error)
      return item
    }
  }
  const renderTool = (item: ToolThought) => (
    <div className='' key={item.input.id}>
      <div>Used {item.input.tool}</div>
      <div></div>
    </div>
  )
  return (
    <div className={cn(s.wrap, !isShowDetail && s.wrapHoverEffect, 'inline-block mb-2 px-2 py-0.5 rounded-md text-xs text-gray-500 font-medium')} >
      <div className='flex items-center h-6 space-x-1 cursor-pointer' onClick={() => setIsShowDetail(!isShowDetail)} >
        {!isThinking ? <ThoughtList /> : <div className='animate-spin'><LodingIcon /></div>}
        <div dangerouslySetInnerHTML={{
          __html: isThinking ? getThoughtText(list[list.length - 1]) as string : (t(`explore.universalChat.thought.${isShowDetail ? 'hide' : 'show'}`) + t('explore.universalChat.thought.processOfThought')) as string,
        }}
        ></div>
        <ChevronDown className={isShowDetail ? 'rotate-180' : ''} />
      </div>
      {isShowDetail && (
        <div>
          {toolThoughtList.map(item => renderTool(item))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Thought)
