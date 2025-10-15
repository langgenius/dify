import type { ActionItem } from './types'

// Create the workflow nodes action
export const workflowNodesAction: ActionItem = {
  key: '@node',
  shortcut: '@node',
  title: 'Search Workflow Nodes',
  description: 'Find and jump to nodes in the current workflow by name or type',
  searchFn: undefined, // Will be set by useWorkflowSearch hook
  search: async (_, searchTerm = '', _locale) => {
    try {
      // Use the searchFn if available (set by useWorkflowSearch hook)
      if (workflowNodesAction.searchFn)
        return workflowNodesAction.searchFn(searchTerm)

      // If not in workflow context, return empty array
      return []
    }
    catch (error) {
      console.warn('Workflow nodes search failed:', error)
      return []
    }
  },
}
