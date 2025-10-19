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
import { useTranslation } from 'react-i18next'
import { useLogs } from './hooks'
import NodePanel from './node'
import SpecialResultPanel from './special-result-panel'
import type { NodeTracing } from '@/types/workflow'
import formatNodeList from '@/app/components/workflow/run/utils/format-log'

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
  const { t } = useTranslation()
  const treeNodes = formatNodeList(list, t)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
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

    showLoopingDetail,
    setShowLoopingDetailFalse,
    loopResultList,
    loopResultDurationMap,
    loopResultVariableMap,
    handleShowLoopResultList,

    agentOrToolLogItemStack,
    agentOrToolLogListMap,
    handleShowAgentOrToolLog,
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
          className="relative mb-2 ml-4"
          data-parallel-id={node.id}
          onMouseEnter={() => handleParallelMouseEnter(node.id)}
          onMouseLeave={handleParallelMouseLeave}
        >
          <div className="mb-1 flex items-center">
            <button type="button"
              onClick={() => toggleCollapse(node.id)}
              className={cn(
                'mr-2 transition-colors',
                isHovered ? 'rounded border-components-button-primary-border bg-components-button-primary-bg text-text-primary-on-surface' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {isHovered ? <RiArrowDownSLine className="h-3 w-3" /> : <RiMenu4Line className="h-3 w-3 text-text-tertiary" />}
            </button>
            <div className="system-xs-semibold-uppercase flex items-center text-text-secondary">
              <span>{parallelDetail.parallelTitle}</span>
            </div>
            <div
              className="mx-2 h-px grow bg-divider-subtle"
              style={{ background: 'linear-gradient(to right, rgba(16, 24, 40, 0.08), rgba(255, 255, 255, 0)' }}
            ></div>
          </div>
          <div className={`relative pl-2 ${isCollapsed ? 'hidden' : ''}`}>
            <div className={cn(
              'absolute bottom-0 left-[5px] top-0 w-[2px]',
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
          <div className={cn('system-2xs-medium-uppercase -mb-1.5 pl-4', isHovered ? 'text-text-tertiary' : 'text-text-quaternary')}>
            {node?.parallelDetail?.branchTitle}
          </div>
          <NodePanel
            nodeInfo={node!}
            allExecutions={list}
            onShowIterationDetail={handleShowIterationResultList}
            onShowLoopDetail={handleShowLoopResultList}
            onShowRetryDetail={handleShowRetryResultList}
            onShowAgentOrToolLog={handleShowAgentOrToolLog}
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

        showLoopingDetail={showLoopingDetail}
        setShowLoopingDetailFalse={setShowLoopingDetailFalse}
        loopResultList={loopResultList}
        loopResultDurationMap={loopResultDurationMap}
        loopResultVariableMap={loopResultVariableMap}

        agentOrToolLogItemStack={agentOrToolLogItemStack}
        agentOrToolLogListMap={agentOrToolLogListMap}
        handleShowAgentOrToolLog={handleShowAgentOrToolLog}
      />
    )
  }

  return (
    <div
      className={cn('py-2', className)}
      onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
      }}
    >
      {treeNodes.map(renderNode)}
    </div>
  )
}

export default TracingPanel
