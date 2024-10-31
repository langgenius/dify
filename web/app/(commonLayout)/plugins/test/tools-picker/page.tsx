'use client'
import { useEffect, useState } from 'react'
import AllTools from '@/app/components/workflow/block-selector/all-tools'
import {
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllWorkflowTools,
} from '@/service/tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'

const ToolsPicker = () => {
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

  return (
    <div className="relative mt-5 mx-auto w-[320px] bg-white">
      <AllTools
        searchText=""
        onSelect={() => { }}
        buildInTools={buildInTools}
        customTools={customTools}
        workflowTools={workflowTools}
      />
    </div>
  )
}

export default ToolsPicker
