'use client'
import type { FC } from 'react'
import
React,
{
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import {
  RiArrowDownSLine,
  RiMenu4Line,
} from '@remixicon/react'
import { useLogs } from './hooks'
import NodePanel from './node'
import SpecialResultPanel from './special-result-panel'
import type { NodeTracing } from '@/types/workflow'

type TracingPanelProps = {
  list: NodeTracing[]
  className?: string
  hideNodeInfo?: boolean
  hideNodeProcessDetail?: boolean
}

const TracingPanel: FC<TracingPanelProps> = ({
  list,
  className,
  hideNodeInfo = false,
  hideNodeProcessDetail = false,
}) => {
  const treeNodes = list
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [hoveredParallel, setHoveredParallel] = useState<string | null>(null)

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id))
        newSet.delete(id)

      else
        newSet.add(id)

      return newSet
    })
  }

  const handleParallelMouseEnter = useCallback((id: string) => {
    setHoveredParallel(id)
  }, [])

  const handleParallelMouseLeave = useCallback((e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as Element | null
    if (relatedTarget && 'closest' in relatedTarget) {
      const closestParallel = relatedTarget.closest('[data-parallel-id]')
      if (closestParallel)
        setHoveredParallel(closestParallel.getAttribute('data-parallel-id'))

      else
        setHoveredParallel(null)
    }
    else {
      setHoveredParallel(null)
    }
  }, [])

  const {
    showSpecialResultPanel,

    showRetryDetail,
    setShowRetryDetailFalse,
    retryResultList,
    handleShowRetryResultList,

    showIteratingDetail,
    setShowIteratingDetailFalse,
    iterationResultList,
    iterationResultDurationMap,
    handleShowIterationResultList,

    agentResultList,
    setAgentResultList,
  } = useLogs()

  const renderNode = (node: NodeTracing) => {
    const isParallelFirstNode = !!node.parallelDetail?.isParallelStartNode
    if (isParallelFirstNode) {
      const parallelDetail = node.parallelDetail!
      const isCollapsed = collapsedNodes.has(node.id)
      const isHovered = hoveredParallel === node.id
      return (
        <div
          key={node.id}
          className="ml-4 mb-2 relative"
          data-parallel-id={node.id}
          onMouseEnter={() => handleParallelMouseEnter(node.id)}
          onMouseLeave={handleParallelMouseLeave}
        >
          <div className="flex items-center mb-1">
            <button
              onClick={() => toggleCollapse(node.id)}
              className={cn(
                'mr-2 transition-colors',
                isHovered ? 'rounded border-components-button-primary-border bg-components-button-primary-bg text-text-primary-on-surface' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {isHovered ? <RiArrowDownSLine className="w-3 h-3" /> : <RiMenu4Line className="w-3 h-3 text-text-tertiary" />}
            </button>
            <div className="system-xs-semibold-uppercase text-text-secondary flex items-center">
              <span>{parallelDetail.parallelTitle}</span>
            </div>
            <div
              className="mx-2 grow h-px bg-divider-subtle"
              style={{ background: 'linear-gradient(to right, rgba(16, 24, 40, 0.08), rgba(255, 255, 255, 0)' }}
            ></div>
          </div>
          <div className={`pl-2 relative ${isCollapsed ? 'hidden' : ''}`}>
            <div className={cn(
              'absolute top-0 bottom-0 left-[5px] w-[2px]',
              isHovered ? 'bg-text-accent-secondary' : 'bg-divider-subtle',
            )}></div>
            {parallelDetail.children!.map(renderNode)}
          </div>
        </div>
      )
    }
    else {
      const isHovered = hoveredParallel === node.id
      return (
        <div key={node.id}>
          <div className={cn('pl-4 -mb-1.5 system-2xs-medium-uppercase', isHovered ? 'text-text-tertiary' : 'text-text-quaternary')}>
            {node?.parallelDetail?.branchTitle}
          </div>
          <NodePanel
            nodeInfo={node!}
            onShowIterationDetail={handleShowIterationResultList}
            onShowRetryDetail={handleShowRetryResultList}
            onShowAgentResultList={setAgentResultList}
            justShowIterationNavArrow={true}
            justShowRetryNavArrow={true}
            hideInfo={hideNodeInfo}
            hideProcessDetail={hideNodeProcessDetail}
          />
        </div>
      )
    }
  }

  if (showSpecialResultPanel) {
    return (
      <SpecialResultPanel
        showRetryDetail={showRetryDetail}
        setShowRetryDetailFalse={setShowRetryDetailFalse}
        retryResultList={retryResultList}

        showIteratingDetail={showIteratingDetail}
        setShowIteratingDetailFalse={setShowIteratingDetailFalse}
        iterationResultList={iterationResultList}
        iterationResultDurationMap={iterationResultDurationMap}

        agentResultList={agentResultList}
        setAgentResultList={setAgentResultList}
      />
    )
  }

  return (
    <div className={cn(className || 'bg-components-panel-bg', 'py-2')}>
      {treeNodes.map(renderNode)}
    </div>
  )
}

export default TracingPanel
