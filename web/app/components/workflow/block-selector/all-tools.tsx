import {
  useMemo,
  useState,
} from 'react'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import { useStore } from '../store'
import { ToolTypeEnum } from './types'
import Tools from './tools'
import { useToolTabs } from './hooks'
import cn from '@/utils/classnames'

type AllToolsProps = {
  searchText: string
  onSelect: OnSelectBlock
}
const AllTools = ({
  searchText,
  onSelect,
}: AllToolsProps) => {
  const tabs = useToolTabs()
  const [activeTab, setActiveTab] = useState(ToolTypeEnum.All)
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)

  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }

  const tools = useMemo(() => {
    let mergedTools: ToolWithProvider[] = []
    if (activeTab === ToolTypeEnum.All)
      mergedTools = [...buildInTools, ...customTools, ...workflowTools]
    if (activeTab === ToolTypeEnum.BuiltIn)
      mergedTools = buildInTools
    if (activeTab === ToolTypeEnum.Custom)
      mergedTools = customTools
    if (activeTab === ToolTypeEnum.Workflow)
      mergedTools = workflowTools

    return mergedTools.filter((toolWithProvider) => {
      return isMatchingKeywords(toolWithProvider.name, searchText)
        || toolWithProvider.tools.some((tool) => {
          return Object.values(tool.label).some((label) => {
            return isMatchingKeywords(label, searchText)
          })
        })
    })
  }, [activeTab, buildInTools, customTools, workflowTools, searchText])
  return (
    <div>
      <div className='flex items-center px-3 h-8 space-x-1 bg-background-default-hover border-b-[0.5px] border-divider-subtle shadow-xs'>
        {
          tabs.map(tab => (
            <div
              className={cn(
                'flex items-center px-2 h-6 rounded-md hover:bg-state-base-hover-alt cursor-pointer',
                'system-xs-medium text-text-tertiary',
                activeTab === tab.key && 'system-xs-semibold bg-state-base-hover-alt text-text-primary',
              )}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.name}
            </div>
          ))
        }
      </div>
      <Tools
        showWorkflowEmpty={activeTab === ToolTypeEnum.Workflow}
        tools={tools}
        onSelect={onSelect}
      />
    </div>
  )
}

export default AllTools
