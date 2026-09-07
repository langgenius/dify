import type { MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'
import { useWorkflowStore } from '../store'
import { readWorkflowClipboard } from '../utils'

export const usePanelInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { data: appDslVersion = '' } = useQuery(
    consoleQuery.appDslVersion.get.queryOptions({
      staleTime: Infinity,
      select: (data) => data.app_dsl_version,
    }),
  )

  const handlePaneContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      // Sync the latest system clipboard into the workflow store before opening
      // the pane menu because "Paste here" is disabled when no compatible node
      // copy exists, including cross-app copies written outside this tab.
      void readWorkflowClipboard(appDslVersion).then(({ nodes, edges }) => {
        if (nodes.length) workflowStore.getState().setClipboardData({ nodes, edges })
      })

      workflowStore.setState({
        contextMenuTarget: { type: 'panel' },
      })
    },
    [workflowStore, appDslVersion],
  )

  const handlePaneContextmenuCancel = useCallback(() => {
    workflowStore.setState({ contextMenuTarget: undefined })
  }, [workflowStore])

  return {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
  }
}
