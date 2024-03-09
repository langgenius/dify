'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import NodePanel from './node'
import Loading from '@/app/components/base/loading'
import { fetchTracingList } from '@/service/log'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { NodeTracing } from '@/types/workflow'
import { ToastContext } from '@/app/components/base/toast'

type TracingProps = {
  runID: string
}

const Tracing: FC<TracingProps> = ({ runID }) => {
  const { notify } = useContext(ToastContext)
  const { appDetail } = useAppStore()
  const [loading, setLoading] = useState<boolean>(true)
  const [list, setList] = useState<NodeTracing[]>([])
  const [collapseState, setCollapseState] = useState<boolean[]>([])

  const getTracingList = useCallback(async (appID: string, runID: string) => {
    setLoading(true)
    try {
      const { data: nodeList } = await fetchTracingList({
        url: `/apps/${appID}/workflow-runs/${runID}/node-executions`,
      })
      const collapseState = nodeList.map(node => node.status === 'succeeded')
      setList(nodeList)
      setCollapseState(collapseState)
      setLoading(false)
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    if (appDetail && runID)
      getTracingList(appDetail.id, runID)
  }, [appDetail, getTracingList, runID])

  const collapseStateChange = (index: number) => {
    const newCollapseState = produce(collapseState, (draft: boolean[]) => {
      draft[index] = !draft[index]
    })
    setCollapseState(newCollapseState)
  }

  if (loading) {
    return (
      <div className='flex h-full items-center justify-center bg-white'>
        <Loading />
      </div>
    )
  }

  return (
    <div className='bg-gray-50 py-2'>
      {list.map((node, index) => (
        <NodePanel
          key={node.id}
          nodeInfo={node}
          collapsed={collapseState[index]}
          collapseHandle={() => collapseStateChange(index)}
        />
      ))}
    </div>
  )
}

export default Tracing
