'use client'
import type { FC } from 'react'
import type { WorkflowRunScope } from './workflow-tool-tracing-context'
import type { NodeTracing } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { use, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import formatNodeList from '@/app/components/workflow/run/utils/format-log'
import { getHoveredParallelId } from './get-hovered-parallel-id'
import { useLogs } from './hooks'
import NodePanel from './node'
import SpecialResultPanel from './special-result-panel'
import WorkflowToolTracing from './workflow-tool-tracing'
import { WorkflowToolTracingContext } from './workflow-tool-tracing-context'

type TracingPanelProps = {
  list: NodeTracing[]
  className?: string
  hideNodeInfo?: boolean
  hideNodeProcessDetail?: boolean
  workflowRun?: WorkflowRunScope
}

const TracingPanel: FC<TracingPanelProps> = ({
  list,
  className,
  hideNodeInfo = false,
  hideNodeProcessDetail = false,
  workflowRun,
}) => {
  const inheritedTracing = use(WorkflowToolTracingContext)
  const runScope = workflowRun ?? inheritedTracing?.workflowRun
  const [workflowTool, setWorkflowTool] = useState<NodeTracing | null>(null)
  const { t } = useTranslation()
  const treeNodes = formatNodeList(list, t)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
  const [hoveredParallel, setHoveredParallel] = useState<string | null>(null)

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)

      return newSet
    })
  }

  const handleParallelMouseEnter = useCallback((id: string) => {
    setHoveredParallel(id)
  }, [])

  const handleParallelMouseLeave = useCallback((e: React.MouseEvent) => {
    setHoveredParallel(getHoveredParallelId(e.relatedTarget))
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
            <button
              type="button"
              aria-controls={`${node.id}-children`}
              aria-expanded={!isCollapsed}
              aria-label={parallelDetail.parallelTitle}
              onClick={() => toggleCollapse(node.id)}
              className={cn(
                'mr-2 transition-colors',
                isHovered
                  ? 'rounded-sm border-components-button-primary-border bg-components-button-primary-bg text-text-primary-on-surface'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {isHovered ? (
                <span aria-hidden className="i-ri-arrow-down-s-line size-3" />
              ) : (
                <span aria-hidden className="i-ri-menu-4-line size-3 text-text-tertiary" />
              )}
            </button>
            <div className="flex items-center system-xs-semibold-uppercase text-text-secondary">
              <span>{parallelDetail.parallelTitle}</span>
            </div>
            <div
              className="mx-2 h-px grow bg-divider-subtle"
              style={{
                background:
                  'linear-gradient(to right, rgba(16, 24, 40, 0.08), rgba(255, 255, 255, 0)',
              }}
            ></div>
          </div>
          <div
            id={`${node.id}-children`}
            className={`relative pl-2 ${isCollapsed ? 'hidden' : ''}`}
          >
            <div
              className={cn(
                'absolute top-0 bottom-0 left-1.25 w-0.5',
                isHovered ? 'bg-text-accent-secondary' : 'bg-divider-subtle',
              )}
            ></div>
            {parallelDetail.children!.map(renderNode)}
          </div>
        </div>
      )
    } else {
      const isHovered = hoveredParallel === node.id
      return (
        <div key={node.id}>
          <div
            className={cn(
              '-mb-1.5 pl-4 system-2xs-medium-uppercase',
              isHovered ? 'text-text-tertiary' : 'text-text-quaternary',
            )}
          >
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

  const content =
    workflowTool && runScope ? (
      <WorkflowToolTracing
        key={workflowTool.id}
        node={workflowTool}
        workflowRun={runScope}
        onBack={() => setWorkflowTool(null)}
      />
    ) : showSpecialResultPanel ? (
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
    ) : (
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

  return (
    <WorkflowToolTracingContext
      value={runScope ? { workflowRun: runScope, onShowWorkflowTool: setWorkflowTool } : null}
    >
      {content}
    </WorkflowToolTracingContext>
  )
}

export default TracingPanel
