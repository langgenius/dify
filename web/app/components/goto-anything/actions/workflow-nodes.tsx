import type { ActionItem } from './types'
import { BoltIcon } from '@heroicons/react/24/outline'
import i18n from 'i18next'

// Create the workflow nodes action
export const workflowNodesAction: ActionItem = {
  key: '@node',
  shortcut: '@node',
  title: 'Search Workflow Nodes',
  description: 'Find and jump to nodes in the current workflow by name or type',
  searchFn: undefined, // Will be set by useWorkflowSearch hook
  search: async (_, searchTerm = '', locale) => {
    try {
      // Use the searchFn if available (set by useWorkflowSearch hook)
      if (workflowNodesAction.searchFn) {
        // searchFn already returns SearchResult[] type, no need to use parser
        return workflowNodesAction.searchFn(searchTerm)
      }

      // If not in workflow context or search function not registered
      if (!searchTerm.trim()) {
        return [{
          id: 'help',
          title: i18n.t('app.gotoAnything.actions.searchWorkflowNodes', { lng: locale }),
          description: i18n.t('app.gotoAnything.actions.searchWorkflowNodesHelp', { lng: locale }),
          type: 'workflow-node',
          path: '#',
          data: {} as any,
          icon: (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
              <BoltIcon className="h-5 w-5" />
            </div>
          ),
        }]
      }

      return []
    }
 catch (error) {
      console.error('Error searching workflow nodes:', error)
      return []
    }
  },
}
