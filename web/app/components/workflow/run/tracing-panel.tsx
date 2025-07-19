'use client'
import type { FC } from 'react'
import
React,
{
  useCallback,
  useMemo,
  useState,
} from 'react'
import cn from 'classnames'
import {
  RiArrowDownSLine,
  RiCloseLine,
  RiMenu4Line,
  RiSearchLine,
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
  enableSearch?: boolean
}

const TracingPanel: FC<TracingPanelProps> = ({
  list,
  className,
  hideNodeInfo = false,
  hideNodeProcessDetail = false,
  enableSearch = false,
}) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  const treeNodes = formatNodeList(list, t)

  // 递归计算节点总数（包括子节点）
  const countNodesRecursively = useCallback((nodes: any[]): number => {
    return nodes.reduce((count, node) => {
      let nodeCount = 1
      if (node.parallelDetail?.children)
        nodeCount += countNodesRecursively(node.parallelDetail.children)
      return count + nodeCount
    }, 0)
  }, [])

  // 深度递归搜索过滤逻辑
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return treeNodes

    const query = searchQuery.toLowerCase().trim()

    // 深度搜索对象内容
    const searchInObject = (obj: any): boolean => {
      if (!obj) return false
      if (typeof obj === 'string') return obj.toLowerCase().includes(query)
      if (typeof obj === 'number') return obj.toString().includes(query)
      if (Array.isArray(obj)) return obj.some(item => searchInObject(item))
      if (typeof obj === 'object')
        return Object.values(obj).some(value => searchInObject(value))
      return false
    }

    // 搜索单个节点的所有内容
    const searchInNode = (node: any): boolean => {
      return (
        node.title?.toLowerCase().includes(query)
        || node.node_type?.toLowerCase().includes(query)
        || node.status?.toLowerCase().includes(query)
        || searchInObject(node.inputs)
        || searchInObject(node.outputs)
        || searchInObject(node.process_data)
        || searchInObject(node.execution_metadata)
      )
    }

    // 递归搜索节点及其所有子节点
    const searchNodeRecursively = (node: any): boolean => {
      // 搜索当前节点
      if (searchInNode(node)) return true

      // 搜索并行分支子节点
      if (node.parallelDetail?.children)
        return node.parallelDetail.children.some((child: any) => searchNodeRecursively(child))

      return false
    }

    // 递归过滤节点树，保持层级结构
    const filterNodesRecursively = (nodes: any[]): any[] => {
      return nodes.reduce((acc: any[], node: any) => {
        const nodeMatches = searchInNode(node)
        const hasMatchingChildren = node.parallelDetail?.children
          ? node.parallelDetail.children.some((child: any) => searchNodeRecursively(child))
          : false

        if (nodeMatches || hasMatchingChildren) {
          const filteredNode = { ...node }

          // 如果有并行子节点，递归过滤它们
          if (node.parallelDetail?.children) {
            const filteredChildren = filterNodesRecursively(node.parallelDetail.children)
            if (filteredChildren.length > 0) {
              filteredNode.parallelDetail = {
                ...node.parallelDetail,
                children: filteredChildren,
              }
            }
          }

          acc.push(filteredNode)
        }

        return acc
      }, [])
    }

    return filterNodesRecursively(treeNodes)
  }, [treeNodes, searchQuery])
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
      className={cn('flex h-full flex-col', className)}
      onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
      }}
    >
      {/* 搜索框 */}
      {enableSearch && (
        <div className="border-b border-divider-subtle px-4 py-3">
          <div className="flex h-8 items-center rounded-lg bg-components-input-bg-normal px-2 hover:bg-components-input-bg-hover">
            <RiSearchLine className="mr-1.5 h-4 w-4 shrink-0 text-components-input-text-placeholder" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('workflow.common.searchNodes') || 'Search nodes, types, inputs, outputs...'}
              className="system-sm-regular block h-[18px] grow appearance-none border-0 bg-transparent text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder"
              autoComplete="off"
            />
            {searchQuery && (
              <div className="ml-1 cursor-pointer" onClick={() => setSearchQuery('')}>
                <RiCloseLine className="h-4 w-4 text-components-input-text-placeholder hover:text-text-tertiary" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 搜索结果统计 */}
      {enableSearch && searchQuery && (
        <div className="border-b border-divider-subtle px-4 py-2">
          <div className="system-xs-regular text-text-tertiary">
            {filteredNodes.length === 0
              ? t('workflow.common.noSearchResults')
              : t('workflow.common.searchResults', {
                matched: countNodesRecursively(filteredNodes),
                total: countNodesRecursively(treeNodes),
              })}
          </div>
        </div>
      )}

      {/* 无搜索结果提示 */}
      {enableSearch && searchQuery && filteredNodes.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-text-tertiary">
          <div className="system-sm-medium mb-2">{t('workflow.common.noSearchResults')}</div>
          <div className="system-xs-regular">
            {t('workflow.common.searchHint', { query: searchQuery })}
          </div>
        </div>
      )}

      {/* 追踪内容 */}
      <div className={cn('flex-1 overflow-y-auto py-2', { 'py-0': enableSearch })}>
        {filteredNodes.length > 0 && filteredNodes.map(renderNode)}
      </div>
    </div>
  )
}

export default TracingPanel
