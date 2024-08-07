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
import { useGetLanguage } from '@/context/i18n'

type AllToolsProps = {
  searchText: string
  onSelect: OnSelectBlock
}
const AllTools = ({
  searchText,
  onSelect,
}: AllToolsProps) => {
  const language = useGetLanguage()
  const tabs = useToolTabs()
  const [activeTab, setActiveTab] = useState(ToolTypeEnum.All)
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)

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
      return toolWithProvider.tools.some((tool) => {
        return tool.label[language].toLowerCase().includes(searchText.toLowerCase())
      })
    })
  }, [activeTab, buildInTools, customTools, workflowTools, searchText, language])
  return (
    <div>
      <div className='flex items-center px-3 h-8 space-x-1 bg-gray-25 border-b-[0.5px] border-black/[0.08] shadow-xs'>
        {
          tabs.map(tab => (
            <div
              className={cn(
                'flex items-center px-2 h-6 rounded-md hover:bg-gray-100 cursor-pointer',
                'text-xs font-medium text-gray-700',
                activeTab === tab.key && 'bg-gray-200',
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
