import { act, renderHook } from '@testing-library/react'
import { deleteDB } from 'idb'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDraftServer, createNodeDraft } from '../../core/__tests__/test-loro-draft-server'
import { collaborationManager } from '../../core/collaboration-manager'
import { webSocketClient } from '../../core/websocket-manager'
import { useCollaboration } from '../use-collaboration'

it('keeps the joined socket and active collaborators when the draft epoch changes', async () => {
  const server = createDraftServer(createNodeDraft)
  const transport = server.transport()
  const connect = vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  const disconnect = vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  const store = createWorkflowStore({})
  store.setState({ loroDraft: server.identity })
  const resource = {
    kind: 'app',
    appId: 'app-1',
    mode: 'workflow',
    collaborationEnabled: true,
  } as const
  const { result, unmount } = renderHook(() => useCollaboration(resource.appId, true), {
    wrapper: ({ children }) => (
      <QueryWrapper>
        <EditorResourceScope resource={resource}>
          <WorkflowContext value={store}>{children}</WorkflowContext>
        </EditorResourceScope>
      </QueryWrapper>
    ),
  })
  try {
    await act(async () => {
      await vi.waitFor(() =>
        expect(transport.emit).toHaveBeenCalledWith(
          'user_connect',
          { workflow_id: resource.appId },
          expect.any(Function),
        ),
      )
    })
    const user = { user_id: 'editor-a', username: 'Alex', avatar: '', sid: 'tab-1' }
    act(() => {
      transport.acknowledge('user_connect', { msg: 'connected' })
      transport.receive('online_users', { users: [user] })
    })
    await vi.waitFor(() => expect(collaborationManager.canPersistLocalGraph()).toBe(true))

    const replacement = server.replace()
    act(() => {
      collaborationManager.replaceLoroDraft(resource.appId, replacement)
      store.setState({ loroDraft: replacement })
    })
    await vi.waitFor(() =>
      expect(collaborationManager.getNodes()[0]?.data.title).toBe('Replacement'),
    )
    expect(connect).toHaveBeenCalledOnce()
    expect(disconnect).not.toHaveBeenCalled()
    expect(result.current.isConnected).toBe(true)
    expect(result.current.onlineUsers).toEqual([user])
  } finally {
    unmount()
    try {
      expect(transport.socket.listeners('loro_draft_changed')).toEqual([])
      expect(transport.socket.listeners('online_users')).toEqual([])
    } finally {
      collaborationManager.disconnect()
      vi.restoreAllMocks()
      await deleteDB('dify-workflow-loro')
    }
  }
})
