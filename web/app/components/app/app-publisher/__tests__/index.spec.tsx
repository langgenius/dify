/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import AppPublisher from '../index'

const mockOnPublish = vi.fn()
const mockOnToggle = vi.fn()
const mockSetAppDetail = vi.fn()
const mockTrackEvent = vi.fn()
const mockRefetch = vi.fn()
const mockOpenAsyncWindow = vi.fn()
const mockFetchInstalledAppList = vi.fn()
const mockFetchAppDetailDirect = vi.fn()
const mockToastError = vi.fn()
const mockInvalidateAppWorkflow = vi.fn()

const sectionProps = vi.hoisted(() => ({
  summary: null as null | Record<string, any>,
  access: null as null | Record<string, any>,
  actions: null as null | Record<string, any>,
}))
const ahooksMocks = vi.hoisted(() => ({
  keyPressHandlers: [] as Array<(event: { preventDefault: () => void }) => void>,
}))

let mockAppDetail: Record<string, any> | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', async () => {
  return {
    useKeyPress: (_keys: unknown, handler: (event: { preventDefault: () => void }) => void) => {
      ahooksMocks.keyPressHandlers.push(handler)
    },
  }
})

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: Record<string, any> | null, setAppDetail: typeof mockSetAppDetail }) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { webapp_auth: { enabled: boolean } } }) => unknown) => selector({
    systemFeatures: {
      webapp_auth: {
        enabled: true,
      },
    },
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'moments ago',
  }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => mockOpenAsyncWindow,
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => ({
    data: { result: true },
    isLoading: false,
    refetch: mockRefetch,
  }),
  useAppWhiteListSubjects: () => ({
    data: { groups: [], members: [] },
    isLoading: false,
  }),
}))

vi.mock('@/service/explore', () => ({
  fetchInstalledAppList: (...args: unknown[]) => mockFetchInstalledAppList(...args),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: (...args: unknown[]) => mockFetchAppDetailDirect(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAppWorkflow: () => mockInvalidateAppWorkflow,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => (isShow
    ? (
        <div data-testid="embedded-modal">
          embedded modal
          <button onClick={onClose}>close-embedded-modal</button>
        </div>
      )
    : null),
}))

vi.mock('../../app-access-control', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: () => Promise<void>, onClose: () => void }) => (
    <div data-testid="access-control">
      <button onClick={() => void onConfirm()}>confirm-access-control</button>
      <button onClick={onClose}>close-access-control</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')
  const OpenContext = ReactModule.createContext(false)

  return {
    PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
      <OpenContext.Provider value={open}>
        <div>{children}</div>
      </OpenContext.Provider>
    ),
    PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
      <div onClick={onClick}>{children}</div>
    ),
    PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
      const open = ReactModule.useContext(OpenContext)
      return open ? <div>{children}</div> : null
    },
  }
})

vi.mock('../sections', () => ({
  PublisherSummarySection: (props: Record<string, any>) => {
    sectionProps.summary = props
    return (
      <div>
        <button onClick={() => void props.handlePublish()}>publisher-summary-publish</button>
        <button onClick={() => void props.handleRestore()}>publisher-summary-restore</button>
      </div>
    )
  },
  PublisherAccessSection: (props: Record<string, any>) => {
    sectionProps.access = props
    return <button onClick={props.onClick}>publisher-access-control</button>
  },
  PublisherActionsSection: (props: Record<string, any>) => {
    sectionProps.actions = props
    return (
      <div>
        <button onClick={props.handleEmbed}>publisher-embed</button>
        <button onClick={() => void props.handleOpenInExplore()}>publisher-open-in-explore</button>
      </div>
    )
  },
}))

describe('AppPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ahooksMocks.keyPressHandlers.length = 0
    sectionProps.summary = null
    sectionProps.access = null
    sectionProps.actions = null
    mockAppDetail = {
      id: 'app-1',
      name: 'Demo App',
      mode: AppModeEnum.CHAT,
      access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      site: {
        app_base_url: 'https://example.com',
        access_token: 'token-1',
      },
    }
    mockFetchInstalledAppList.mockResolvedValue({
      installed_apps: [{ id: 'installed-1' }],
    })
    mockFetchAppDetailDirect.mockResolvedValue({
      id: 'app-1',
      access_mode: AccessMode.PUBLIC,
    })
    mockOpenAsyncWindow.mockImplementation(async (resolver: () => Promise<string>) => {
      await resolver()
    })
  })

  it('should open the publish popover and refetch access permission data', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
        onToggle={mockOnToggle}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))

    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
    expect(mockOnToggle).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })
  })

  it('should publish and track the publish event', async () => {
    mockOnPublish.mockResolvedValue(undefined)

    render(
      <AppPublisher
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-summary-publish'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).toHaveBeenCalledWith('app_published_time', expect.objectContaining({
        action_mode: 'app',
        app_id: 'app-1',
        app_name: 'Demo App',
      }))
    })
  })

  it('should open the embedded modal from the actions section', () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-embed'))

    expect(screen.getByTestId('embedded-modal'))!.toBeInTheDocument()
  })

  it('should close embedded and access control panels through child callbacks', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-embed'))
    fireEvent.click(screen.getByText('close-embedded-modal'))
    expect(screen.queryByTestId('embedded-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-access-control'))
    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()
    fireEvent.click(screen.getByText('close-access-control'))
    expect(screen.queryByTestId('access-control')).not.toBeInTheDocument()
  })

  it('should refresh app detail after access control confirmation', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-access-control'))

    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith({
        id: 'app-1',
        access_mode: AccessMode.PUBLIC,
      })
    })
  })

  it('should open the installed explore page through the async window helper', async () => {
    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-open-in-explore'))

    await waitFor(() => {
      expect(mockOpenAsyncWindow).toHaveBeenCalledTimes(1)
      expect(mockFetchInstalledAppList).toHaveBeenCalledWith('app-1')
      expect(sectionProps.actions?.appURL).toBe(`https://example.com${basePath}/chat/token-1`)
    })
  })

  it('should ignore the trigger when the publish button is disabled', () => {
    render(
      <AppPublisher
        disabled
        publishedAt={Date.now()}
        onToggle={mockOnToggle}
      />,
    )

    fireEvent.click(screen.getByText('common.publish').parentElement?.parentElement as HTMLElement)

    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()
    expect(mockOnToggle).not.toHaveBeenCalled()
  })

  it('should publish from the keyboard shortcut and restore the popover state', async () => {
    const preventDefault = vi.fn()
    const onRestore = vi.fn().mockResolvedValue(undefined)
    mockOnPublish.mockResolvedValue(undefined)

    render(
      <AppPublisher
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )

    ahooksMocks.keyPressHandlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-summary-restore'))

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('publisher-summary-publish')).not.toBeInTheDocument()
  })

  it('should keep the popover open when restore fails and reset published state after publish failures', async () => {
    const preventDefault = vi.fn()
    const onRestore = vi.fn().mockRejectedValue(new Error('restore failed'))
    mockOnPublish.mockRejectedValueOnce(new Error('publish failed'))

    render(
      <AppPublisher
        publishedAt={Date.now()}
        onPublish={mockOnPublish}
        onRestore={onRestore}
      />,
    )

    ahooksMocks.keyPressHandlers[0]!({ preventDefault })

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled()
      expect(mockOnPublish).toHaveBeenCalledTimes(1)
    })
    expect(mockTrackEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-summary-restore'))

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('publisher-summary-publish'))!.toBeInTheDocument()
  })

  it('should report missing explore installations', async () => {
    mockFetchInstalledAppList.mockResolvedValueOnce({
      installed_apps: [],
    })
    mockOpenAsyncWindow.mockImplementation(async (resolver: () => Promise<string>, options: { onError: (error: Error) => void }) => {
      try {
        await resolver()
      }
      catch (error) {
        options.onError(error as Error)
      }
    })

    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-open-in-explore'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('No app found in Explore')
    })
  })

  it('should report explore errors when the app cannot be opened', async () => {
    mockAppDetail = {
      ...mockAppDetail,
      id: undefined,
    }
    mockOpenAsyncWindow.mockImplementation(async (resolver: () => Promise<string>, options: { onError: (error: Error) => void }) => {
      try {
        await resolver()
      }
      catch (error) {
        options.onError(error as Error)
      }
    })

    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-open-in-explore'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('App not found')
    })
  })

  it('should keep access control open when app detail is unavailable during confirmation', async () => {
    mockAppDetail = null

    render(
      <AppPublisher
        publishedAt={Date.now()}
      />,
    )

    fireEvent.click(screen.getByText('common.publish'))
    fireEvent.click(screen.getByText('publisher-access-control'))
    fireEvent.click(screen.getByText('confirm-access-control'))

    await waitFor(() => {
      expect(mockFetchAppDetailDirect).not.toHaveBeenCalled()
    })
    expect(screen.getByTestId('access-control'))!.toBeInTheDocument()
  })
})
