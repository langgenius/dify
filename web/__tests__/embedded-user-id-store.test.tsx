import { screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import {
  createSystemFeaturesWrapper,
  renderWithSystemFeatures,
} from '@/__tests__/utils/mock-system-features'
import WebAppStoreProvider, { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'

const navigationMocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/chatbot/sample-app'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

const useGetWebAppAccessModeByCodeMock = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  usePathname: navigationMocks.usePathname,
  useSearchParams: navigationMocks.useSearchParams,
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppAccessModeByCode: (...args: unknown[]) => useGetWebAppAccessModeByCodeMock(...args),
}))

const mockGetProcessedSystemVariablesFromUrlParams = vi.fn()

vi.mock('@/app/components/base/chat/utils', () => ({
  getProcessedSystemVariablesFromUrlParams: (...args: any[]) =>
    mockGetProcessedSystemVariablesFromUrlParams(...args),
}))

const TestConsumer = () => {
  const embeddedUserId = useWebAppStore((state) => state.embeddedUserId)
  const embeddedConversationId = useWebAppStore((state) => state.embeddedConversationId)
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
  mockGetProcessedSystemVariablesFromUrlParams.mockReset()
  navigationMocks.usePathname.mockReset()
  navigationMocks.usePathname.mockReturnValue('/chatbot/sample-app')
  navigationMocks.useSearchParams.mockReset()
  navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams())
  useGetWebAppAccessModeByCodeMock.mockReset()
  useGetWebAppAccessModeByCodeMock.mockReturnValue({
    isLoading: false,
    data: { accessMode: AccessMode.PUBLIC },
  })
  useWebAppStore.setState(initialWebAppStore, true)
})

describe('WebAppStoreProvider embedded user id handling', () => {
  it('parses share code from redirect_url during server render without window', () => {
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/redirected-app'))
    navigationMocks.usePathname.mockReturnValue('/webapp-signin')
    navigationMocks.useSearchParams.mockReturnValue(params)
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    })
    const { wrapper: Wrapper } = createSystemFeaturesWrapper()

    try {
      expect(() =>
        renderToString(
          <Wrapper>
            <WebAppStoreProvider>
              <div />
            </WebAppStoreProvider>
          </Wrapper>,
        ),
      ).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }

    expect(useGetWebAppAccessModeByCodeMock).toHaveBeenCalledWith('redirected-app')
  })

  it('does not derive a share code from an external redirect target', () => {
    const params = new URLSearchParams()
    params.set('redirect_url', 'https://evil.example/chatbot/evil-app')
    navigationMocks.usePathname.mockReturnValue('/webapp-signin')
    navigationMocks.useSearchParams.mockReturnValue(params)
    mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({})

    renderWithSystemFeatures(
      <WebAppStoreProvider>
        <TestConsumer />
      </WebAppStoreProvider>,
    )

    expect(useGetWebAppAccessModeByCodeMock).toHaveBeenCalledWith(null)
  })

  it.each(['/webapp-signin/check-code', '/console/webapp-signin/check-code'])(
    'does not derive a share code from the sign-in route %s',
    (pathname) => {
      navigationMocks.usePathname.mockReturnValue(pathname)
      mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({})

      renderWithSystemFeatures(
        <WebAppStoreProvider>
          <TestConsumer />
        </WebAppStoreProvider>,
      )

      expect(useGetWebAppAccessModeByCodeMock).toHaveBeenCalledWith(null)
    },
  )

  it('hydrates embedded user and conversation ids from system variables', async () => {
    mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({
      user_id: 'iframe-user-123',
      conversation_id: 'conversation-456',
    })

    renderWithSystemFeatures(
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
    useWebAppStore.setState((state) => ({
      ...state,
      embeddedUserId: 'previous-user',
      embeddedConversationId: 'existing-conversation',
    }))
    mockGetProcessedSystemVariablesFromUrlParams.mockResolvedValue({})

    renderWithSystemFeatures(
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
