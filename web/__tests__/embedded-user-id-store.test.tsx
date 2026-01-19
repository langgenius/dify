import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import WebAppStoreProvider, { useWebAppStore } from '@/context/web-app-context'

import { AccessMode } from '@/models/access-control'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/chatbot/sample-app'),
  useSearchParams: vi.fn(() => {
    const params = new URLSearchParams()
    return params
  }),
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppAccessModeByCode: vi.fn(() => ({
    isLoading: false,
    data: { accessMode: AccessMode.PUBLIC },
  })),
}))

// Store the mock implementation in a way that survives hoisting
const mockGetProcessedSystemVariablesFromUrlParams = vi.fn()

vi.mock('@/app/components/base/chat/utils', () => ({
  getProcessedSystemVariablesFromUrlParams: (...args: any[]) => mockGetProcessedSystemVariablesFromUrlParams(...args),
}))

// Use vi.hoisted to define mock state before vi.mock hoisting
const { mockGlobalStoreState } = vi.hoisted(() => ({
  mockGlobalStoreState: {
    isGlobalPending: false,
    setIsGlobalPending: vi.fn(),
    systemFeatures: {},
    setSystemFeatures: vi.fn(),
  },
}))

vi.mock('@/context/global-public-context', () => {
  const useGlobalPublicStore = Object.assign(
    (selector?: (state: typeof mockGlobalStoreState) => any) =>
      selector ? selector(mockGlobalStoreState) : mockGlobalStoreState,
    {
      setState: (updater: any) => {
        if (typeof updater === 'function')
          Object.assign(mockGlobalStoreState, updater(mockGlobalStoreState) ?? {})

        else
          Object.assign(mockGlobalStoreState, updater)
      },
      __mockState: mockGlobalStoreState,
    },
  )
  return {
    useGlobalPublicStore,
    useIsSystemFeaturesPending: () => false,
  }
})

const TestConsumer = () => {
  const embeddedUserId = useWebAppStore(state => state.embeddedUserId)
  const embeddedConversationId = useWebAppStore(state => state.embeddedConversationId)
  return (
    <>
      <div data-testid="embedded-user-id">{embeddedUserId ?? 'null'}</div>
      <div data-testid="embedded-conversation-id">{embeddedConversationId ?? 'null'}</div>
    </>
  )
}

const initialWebAppStore = (() => {
  const snapshot = useWebAppStore.getState()
  return {
    shareCode: null as string | null,
    appInfo: null,
    appParams: null,
    webAppAccessMode: snapshot.webAppAccessMode,
    appMeta: null,
    userCanAccessApp: false,
    embeddedUserId: null,
    embeddedConversationId: null,
    updateShareCode: snapshot.updateShareCode,
    updateAppInfo: snapshot.updateAppInfo,
    updateAppParams: snapshot.updateAppParams,
    updateWebAppAccessMode: snapshot.updateWebAppAccessMode,
    updateWebAppMeta: snapshot.updateWebAppMeta,
    updateUserCanAccessApp: snapshot.updateUserCanAccessApp,
    updateEmbeddedUserId: snapshot.updateEmbeddedUserId,
    updateEmbeddedConversationId: snapshot.updateEmbeddedConversationId,
  }
})()

beforeEach(() => {
  mockGlobalStoreState.isGlobalPending = false
  mockGetProcessedSystemVariablesFromUrlParams.mockReset()
  useWebAppStore.setState(initialWebAppStore, true)
})

describe('WebAppStoreProvider embedded user id handling', () => {
  it('hydrates embedded user and conversation ids from system variables', async () => {
    mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({
      user_id: 'iframe-user-123',
      conversation_id: 'conversation-456',
    })

    render(
      <WebAppStoreProvider>
        <TestConsumer />
      </WebAppStoreProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('embedded-user-id')).toHaveTextContent('iframe-user-123')
      expect(screen.getByTestId('embedded-conversation-id')).toHaveTextContent('conversation-456')
    })
    expect(useWebAppStore.getState().embeddedUserId).toBe('iframe-user-123')
    expect(useWebAppStore.getState().embeddedConversationId).toBe('conversation-456')
  })

  it('clears embedded user id when system variable is absent', async () => {
    useWebAppStore.setState(state => ({
      ...state,
      embeddedUserId: 'previous-user',
      embeddedConversationId: 'existing-conversation',
    }))
    mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({})

    render(
      <WebAppStoreProvider>
        <TestConsumer />
      </WebAppStoreProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('embedded-user-id')).toHaveTextContent('null')
      expect(screen.getByTestId('embedded-conversation-id')).toHaveTextContent('null')
    })
    expect(useWebAppStore.getState().embeddedUserId).toBeNull()
    expect(useWebAppStore.getState().embeddedConversationId).toBeNull()
  })
})
