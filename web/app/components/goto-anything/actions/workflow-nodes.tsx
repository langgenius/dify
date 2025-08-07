import type { ActionItem, SearchResult } from './types'
import type { BlockEnum, CommonNodeType } from '../../workflow/types'
import { useNodes } from 'reactflow'
import { useToolIcon } from '../../workflow/hooks'
import BlockIcon from '../../workflow/block-icon'
import cn from '@/utils/classnames'

// Parser for workflow nodes to search results
export const parser = (nodes: { id: string, title: string, type: string, desc: string, blockType: BlockEnum, nodeData: CommonNodeType }[]) => {
  return nodes.map(node => ({
    id: node.id,
    title: node.title,
    description: node.desc || node.type,
    type: 'workflow-node' as const,
    path: `#${node.id}`, // Local anchor for node selection
    icon: (
      <BlockIcon
        type={node.blockType}
        toolIcon={useToolIcon(node.nodeData)}
        className='shrink-0'
        size='sm'
      />
    ),
    metadata: {
      nodeId: node.id,
      nodeData: node.nodeData,
    }
  }))
}

// 自定义渲染函数，用于工作流节点搜索结果
const renderWorkflowNodes = (
  results: SearchResult[],
  onNavigate: (result: SearchResult) => void,
  highlightMatch: (text: string, query: string) => React.ReactNode,
  searchQuery: string
) => {
  if (!results.length) return null

  return (
    <div className='p-2'>
      <div className='mb-2 border-b border-divider-subtle pb-2'>
        <div className='text-xs font-medium text-text-tertiary'>
          Workflow Nodes ({results.length})
        </div>
      </div>
      
      {results.map(result => (
        <div
          key={`${result.type}-${result.id}`}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-state-base-hover',
          )}
          onClick={() => onNavigate(result)}
        >
          {result.icon}
          <div className='min-w-0 flex-1'>
            <div className='truncate font-medium text-text-secondary'>
              {highlightMatch(result.title, searchQuery.replace(/@\w+\s*/, ''))}
            </div>
            {result.description && (
              <div className='mt-0.5 truncate text-xs text-text-quaternary'>
                {highlightMatch(result.description, searchQuery.replace(/@\w+\s*/, ''))}
              </div>
            )}
          </div>
          <div className='text-xs text-text-quaternary'>
            Node
          </div>
        </div>
      ))}
    </div>
  )
}

// Create the workflow nodes action
export const workflowNodesAction: ActionItem = {
  key: '@node',
  shortcut: '@node',
  title: 'Search Workflow Nodes',
  description: 'Search and navigate to nodes in the current workflow',
  isGlobal: false, // Page-specific action, only available on workflow pages
  // This will be set by useWorkflowSearch hook
  searchFn: null,
  search: async (_, searchTerm = '') => {
    try {
      // Use the searchFn if available
      if (workflowNodesAction.searchFn) {
        return workflowNodesAction.searchFn(searchTerm);
      }
      console.log('No workflow node search function registered yet');
      return [];
    } catch (error) {
      console.error('Error searching workflow nodes:', error);
      return [];
    }
  },
  renderResults: renderWorkflowNodes,
}
