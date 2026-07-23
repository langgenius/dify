import type { ActionItem } from './types'
import { findWorkflowNodes } from '@/app/components/workflow/goto-anything-search'

export const workflowNodesAction: ActionItem = {
  key: '@node',
  shortcut: '@node',
  title: 'Search Workflow Nodes',
  description: 'Find and jump to nodes in the current workflow by name or type',
  source: 'local',
  search: (_, searchTerm = '', _locale) => {
    try {
      return findWorkflowNodes(searchTerm)
    } catch (error) {
      console.warn('Workflow nodes search failed:', error)
      return []
    }
  },
}
