import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InSiteMessageNotification from '../notification'

const {
  mockConfig,
  mockNotification,
  mockNotificationDismiss,
} = vi.hoisted(() => ({
  mockConfig: {
    isCloudEdition: true,
  },
  mockNotification: vi.fn(),
  mockNotificationDismiss: vi.fn(),
}))

vi.mock(import('@/config'), async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mockConfig.isCloudEdition
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    notification: {
      queryOptions: (options?: Record<string, unknown>) => ({
        queryKey: ['console', 'notification'],
        queryFn: (...args: unknown[]) => mockNotification(...args),
        ...options,
      }),
    },
    notificationDismiss: {
      mutationOptions: (options?: Record<string, unknown>) => ({
        mutationKey: ['console', 'notificationDismiss'],
        mutationFn: (...args: unknown[]) => mockNotificationDismiss(...args),
        ...options,
      }),
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )

  return Wrapper
}

describe('InSiteMessageNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.isCloudEdition = true
    vi.stubGlobal('open', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Validate query gating and empty state rendering.
  describe('Rendering', () => {
    it('should render null and skip query when not cloud edition', async () => {
      mockConfig.isCloudEdition = false
      const Wrapper = createWrapper()
      const { container } = render(<InSiteMessageNotification />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(mockNotification).not.toHaveBeenCalled()
      })
      expect(container).toBeEmptyDOMElement()
    })

    it('should render null when notification list is empty', async () => {
      mockNotification.mockResolvedValue({ notifications: [] })
      const Wrapper = createWrapper()
      const { container } = render(<InSiteMessageNotification />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(mockNotification).toHaveBeenCalledTimes(1)
      })
      expect(container).toBeEmptyDOMElement()
    })
  })

  // Validate parsed-body behavior and action handling.
  describe('Notification body parsing and actions', () => {
    it('should render parsed main/actions and dismiss only on close action', async () => {
      mockNotification.mockResolvedValue({
        notifications: [
          {
            notification_id: 'n-1',
            title: 'Update title',
            subtitle: 'Update subtitle',
            title_pic_url: 'https://example.com/bg.png',
            body: JSON.stringify({
              main: 'Parsed body main',
              actions: [
                { action: 'link', data: 'https://example.com/docs', text: 'Visit docs', type: 'primary' },
                { action: 'close', text: 'Dismiss now', type: 'default' },
                { action: 'link', data: 'https://example.com/invalid', text: 100, type: 'primary' },
              ],
            }),
          },
        ],
      })
      mockNotificationDismiss.mockResolvedValue({ success: true })

      const Wrapper = createWrapper()
      render(<InSiteMessageNotification />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Parsed body main')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Visit docs' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Dismiss now' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Invalid' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Visit docs' }))
      expect(mockNotificationDismiss).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss now' }))
      await waitFor(() => {
        expect(mockNotificationDismiss).toHaveBeenCalledWith(
          {
            body: {
              notification_id: 'n-1',
            },
          },
          expect.objectContaining({
            mutationKey: ['console', 'notificationDismiss'],
          }),
        )
      })
    })

    it('should fallback to raw body and default close action when body is invalid json', async () => {
      mockNotification.mockResolvedValue({
        notifications: [
          {
            notification_id: 'n-2',
            title: 'Fallback title',
            subtitle: 'Fallback subtitle',
            title_pic_url: 'https://example.com/bg-2.png',
            body: 'raw body text',
          },
        ],
      })
      mockNotificationDismiss.mockResolvedValue({ success: true })

      const Wrapper = createWrapper()
      render(<InSiteMessageNotification />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('raw body text')).toBeInTheDocument()
      })

      const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(mockNotificationDismiss).toHaveBeenCalledWith(
          {
            body: {
              notification_id: 'n-2',
            },
          },
          expect.objectContaining({
            mutationKey: ['console', 'notificationDismiss'],
          }),
        )
      })
    })

    it('should fallback to default close action when parsed actions are all invalid', async () => {
      mockNotification.mockResolvedValue({
        notifications: [
          {
            notification_id: 'n-3',
            title: 'Invalid action title',
            subtitle: 'Invalid action subtitle',
            title_pic_url: 'https://example.com/bg-3.png',
            body: JSON.stringify({
              main: 'Main from parsed body',
              actions: [
                { action: 'link', type: 'primary', text: 100, data: 'https://example.com' },
              ],
            }),
          },
        ],
      })

      const Wrapper = createWrapper()
      render(<InSiteMessageNotification />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Main from parsed body')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })
})
