import type { MouseEvent } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useWorkflowStore } from '../store'
import { readWorkflowClipboard } from '../utils'

export const usePanelInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { data: appDslVersion } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.app_dsl_version,
  })

  const handlePaneContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    // Sync the latest system clipboard into the workflow store before opening
    // the pane menu because "Paste here" is disabled when no compatible node
    // copy exists, including cross-app copies written outside this tab.
    void readWorkflowClipboard(appDslVersion).then(({ nodes, edges }) => {
      if (nodes.length)
        workflowStore.getState().setClipboardData({ nodes, edges })
    })

    workflowStore.setState({
      nodeMenu: undefined,
      selectionMenu: undefined,
      edgeMenu: undefined,
      panelMenu: {
        clientX: e.clientX,
        clientY: e.clientY,
      },
    })
  }, [workflowStore, appDslVersion])

  const handlePaneContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      panelMenu: undefined,
    })
  }, [workflowStore])

  const handleNodeContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      nodeMenu: undefined,
    })
  }, [workflowStore])

  const handleEdgeContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      edgeMenu: undefined,
    })
  }, [workflowStore])

  return {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
    handleNodeContextmenuCancel,
    handleEdgeContextmenuCancel,
  }
}
