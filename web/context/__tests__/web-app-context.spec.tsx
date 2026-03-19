import { render, screen, waitFor } from '@testing-library/react'
import WebAppStoreProvider, { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'

let mockPathname = '/share/test-share-code'
let mockRedirectUrl: string | null = null
let mockAccessModeResult: { accessMode: AccessMode } | undefined

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => ({
    get: (key: string) => key === 'redirect_url' ? mockRedirectUrl : null,
    toString: () => {
      const params = new URLSearchParams()
      if (mockRedirectUrl)
        params.set('redirect_url', mockRedirectUrl)
      return params.toString()
    },
  }),
}))

vi.mock('@/app/components/base/chat/utils', () => ({
  getProcessedSystemVariablesFromUrlParams: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppAccessModeByCode: vi.fn(() => ({
    data: mockAccessModeResult,
  })),
}))

const StoreSnapshot = () => {
  const shareCode = useWebAppStore(s => s.shareCode)
  const accessMode = useWebAppStore(s => s.webAppAccessMode)

  return (
    <div>
      <span data-testid="share-code">{shareCode ?? 'none'}</span>
      <span data-testid="access-mode">{accessMode ?? 'unknown'}</span>
    </div>
  )
}

describe('WebAppStoreProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/share/test-share-code'
    mockRedirectUrl = null
    mockAccessModeResult = undefined
    useWebAppStore.setState({
      shareCode: null,
      appInfo: null,
      appParams: null,
      webAppAccessMode: null,
      appMeta: null,
      userCanAccessApp: false,
      embeddedUserId: null,
      embeddedConversationId: null,
    })
  })

  describe('Access Mode State', () => {
    it('should keep the access mode unknown until the query resolves', async () => {
      render(
        <WebAppStoreProvider>
          <StoreSnapshot />
        </WebAppStoreProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('share-code')).toHaveTextContent('test-share-code')
      })
      expect(screen.getByTestId('access-mode')).toHaveTextContent('unknown')
    })

    it('should reset the access mode when the share code changes before the next result arrives', async () => {
      const { rerender } = render(
        <WebAppStoreProvider>
          <StoreSnapshot />
        </WebAppStoreProvider>,
      )

      mockAccessModeResult = { accessMode: AccessMode.PUBLIC }
      rerender(
        <WebAppStoreProvider>
          <StoreSnapshot />
        </WebAppStoreProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('access-mode')).toHaveTextContent(AccessMode.PUBLIC)
      })

      mockPathname = '/share/next-share-code'
      mockAccessModeResult = undefined
      rerender(
        <WebAppStoreProvider>
          <StoreSnapshot />
        </WebAppStoreProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('share-code')).toHaveTextContent('next-share-code')
      })
      expect(screen.getByTestId('access-mode')).toHaveTextContent('unknown')
    })
  })
})
