'use client'
import type { FC } from 'react'
import React from 'react'
import { useEffect, useState } from 'react'
import AllTools from '@/app/components/workflow/block-selector/all-tools'
import type { ToolDefaultValue } from './types'
import {
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllWorkflowTools,
} from '@/service/tools'
import type { BlockEnum, ToolWithProvider } from '@/app/components/workflow/types'

type Props = {
  onSelect: (tool: ToolDefaultValue) => void
  supportAddCustomTool?: boolean
}

const ToolPicker: FC<Props> = ({
  onSelect,
  supportAddCustomTool,
}) => {
  const [searchText, setSearchText] = useState('')

  const [buildInTools, setBuildInTools] = useState<ToolWithProvider[]>([])
  const [customTools, setCustomTools] = useState<ToolWithProvider[]>([])
  const [workflowTools, setWorkflowTools] = useState<ToolWithProvider[]>([])

  useEffect(() => {
    (async () => {
      const buildInTools = await fetchAllBuiltInTools()
      const customTools = await fetchAllCustomTools()
      const workflowTools = await fetchAllWorkflowTools()
      setBuildInTools(buildInTools)
      setCustomTools(customTools)
      setWorkflowTools(workflowTools)
    })()
  }, [])

  const handleSelect = (_type: BlockEnum, tool?: ToolDefaultValue) => {
    onSelect(tool!)
  }

  return (
    <div className="relative mt-5 mx-auto w-[320px] bg-white">
      <input placeholder='search holder' value={searchText} onChange={e => setSearchText(e.target.value)} />
      <AllTools
        className='mt-1'
        searchText={searchText}
        onSelect={handleSelect}
        buildInTools={buildInTools}
        customTools={customTools}
        workflowTools={workflowTools}
        supportAddCustomTool={supportAddCustomTool}
      />
    </div>
  )
}

export default React.memo(ToolPicker)
