import { act, waitFor } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import { useIsChatMode } from '../use-is-chat-mode'

describe('useIsChatMode', () => {
  it('reads the session app mode and reacts to its query updates', async () => {
    const queryClient = createConsoleQueryClient()
    seedAppDetail(queryClient, { id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT })
    seedAppDetail(queryClient, { id: 'another-app', mode: AppModeEnum.WORKFLOW })
    const { result } = renderWorkflowHook(() => useIsChatMode(), {
      initialStoreState: { appId: 'app-1' },
      queryClient,
    })
    expect(result.current).toBe(true)

    act(() => {
      seedAppDetail(queryClient, { id: 'app-1', mode: AppModeEnum.WORKFLOW })
    })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('does not borrow another app mode when a generic workflow has no app identity', () => {
    const queryClient = createConsoleQueryClient()
    seedAppDetail(queryClient, { id: 'another-app', mode: AppModeEnum.ADVANCED_CHAT })
    const { result } = renderWorkflowHook(() => useIsChatMode(), { queryClient })
    expect(result.current).toBe(false)
  })
})
