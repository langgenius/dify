import type { PanelProps } from '@/app/components/workflow/panel'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { memo, useMemo } from 'react'
import {
  isChatflowAtom,
  workflowAppIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import Panel from '@/app/components/workflow/panel'
import CommentsPanel from '@/app/components/workflow/panel/comments-panel'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'

const MessageLogModal = dynamic(() => import('@/app/components/base/message-log-modal'), {
  ssr: false,
})
const Record = dynamic(() => import('@/app/components/workflow/panel/record'), {
  ssr: false,
})
const ChatRecord = dynamic(() => import('@/app/components/workflow/panel/chat-record'), {
  ssr: false,
})
const DebugAndPreview = dynamic(() => import('@/app/components/workflow/panel/debug-and-preview'), {
  ssr: false,
})
const WorkflowPreview = dynamic(() => import('@/app/components/workflow/panel/workflow-preview'), {
  ssr: false,
})
const ChatVariablePanel = dynamic(
  () => import('@/app/components/workflow/panel/chat-variable-panel'),
  {
    ssr: false,
  },
)
const GlobalVariablePanel = dynamic(
  () => import('@/app/components/workflow/panel/global-variable-panel'),
  {
    ssr: false,
  },
)

const WorkflowPanelOnLeft = ({ appId }: { appId: string }) => {
  const messageLogItem = useStore((state) => state.messageLogItem)
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  return (
    <>
      {messageLogItem && (
        <MessageLogModal
          appId={appId}
          fixedWidth
          width={400}
          currentLogItem={messageLogItem}
          onCancel={() => setMessageLogItem(undefined)}
        />
      )}
    </>
  )
}
const WorkflowPanelOnRight = () => {
  const isChatflow = useAtomValue(isChatflowAtom)
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore((s) => s.showDebugAndPreviewPanel)
  const showChatVariablePanel = useStore((s) => s.showChatVariablePanel)
  const showGlobalVariablePanel = useStore((s) => s.showGlobalVariablePanel)
  const controlMode = useStore((s) => s.controlMode)

  return (
    <>
      {historyWorkflowData && !isChatflow && <Record />}
      {historyWorkflowData && isChatflow && <ChatRecord />}
      {showDebugAndPreviewPanel && isChatflow && <DebugAndPreview />}
      {showDebugAndPreviewPanel && !isChatflow && <WorkflowPreview />}
      {showChatVariablePanel && isChatflow && <ChatVariablePanel />}
      {showGlobalVariablePanel && <GlobalVariablePanel />}
      {controlMode === 'comment' && <CommentsPanel />}
    </>
  )
}
const WorkflowPanel = () => {
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const versionHistoryPanelProps = useMemo(() => {
    return {
      latestVersionId: appDetail.workflow?.id,
    }
  }, [appDetail.workflow?.id])

  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: <WorkflowPanelOnLeft appId={appId} />,
        right: <WorkflowPanelOnRight />,
      },
      versionHistoryPanelProps,
    }
  }, [appId, versionHistoryPanelProps])

  return <Panel {...panelProps} />
}

export default memo(WorkflowPanel)
