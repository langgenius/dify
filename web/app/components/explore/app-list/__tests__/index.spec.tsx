import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { fetchAppDetail } from '@/service/explore'
import { useMembers } from '@/service/use-common'
import { AppModeEnum } from '@/types/app'
import AppList from '../index'

let mockExploreData: { categories: string[], allList: App[] } | undefined = { categories: [], allList: [] }
let mockIsLoading = false
let mockIsError = false
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()

vi.mock('@/service/use-explore', () => ({
  useExploreAppList: () => ({
    data: mockExploreData,
    isLoading: mockIsLoading,
    isError: mockIsError,
  }),
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
  fetchAppList: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: vi.fn(),
}))

vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: mockHandleImportDSL,
    handleImportDSLConfirm: mockHandleImportDSLConfirm,
    versions: ['v1'],
    isFetching: false,
  }),
}))

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: (props: CreateAppModalProps) => {
    if (!props.show)
      return null
    return (
      <div data-testid="create-app-modal">
        <button
          data-testid="confirm-create"
          onClick={() => props.onConfirm({
            name: 'New App',
            icon_type: 'emoji',
            icon: '🤖',
            icon_background: '#fff',
            description: 'desc',
          })}
        >
          confirm
        </button>
        <button data-testid="hide-create" onClick={props.onHide}>hide</button>
      </div>
    )
  },
}))

vi.mock('../../try-app', () => ({
  default: ({ onCreate, onClose }: { onCreate: () => void, onClose: () => void }) => (
    <div data-testid="try-app-panel">
      <button data-testid="try-app-create" onClick={onCreate}>create</button>
      <button data-testid="try-app-close" onClick={onClose}>close</button>
    </div>
  ),
}))

vi.mock('../../banner/banner', () => ({
  default: () => <div data-testid="explore-banner">banner</div>,
}))

vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="dsl-confirm" onClick={onConfirm}>confirm</button>
      <button data-testid="dsl-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Alpha',
    description: overrides.app?.description ?? 'Alpha description',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
  can_trial: true,
  app_id: overrides.app_id ?? 'app-1',
  description: overrides.description ?? 'Alpha description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  category: overrides.category ?? 'Writing',
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

const mockMemberRole = (hasEditPermission: boolean) => {
  ;(useAppContext as Mock).mockReturnValue({
    userProfile: { id: 'user-1' },
  })
  ;(useMembers as Mock).mockReturnValue({
    data: {
      accounts: [{ id: 'user-1', role: hasEditPermission ? 'admin' : 'normal' }],
    },
  })
}

const renderAppList = (hasEditPermission = false, onSuccess?: () => void, searchParams?: Record<string, string>) => {
  mockMemberRole(hasEditPermission)
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <AppList onSuccess={onSuccess} />
    </NuqsTestingAdapter>,
  )
}

describe('AppList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockExploreData = { categories: [], allList: [] }
    mockIsLoading = false
    mockIsError = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render loading when the query is loading', () => {
      mockExploreData = undefined
      mockIsLoading = true

      renderAppList()

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render app cards when data is available', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, category: 'Translate' })],
      }

      renderAppList()

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should filter apps by selected category', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, category: 'Translate' })],
      }

      renderAppList(false, undefined, { category: 'Writing' })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should filter apps by search keywords', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should handle create flow and confirm DSL when pending', async () => {
      vi.useRealTimers()
      const onSuccess = vi.fn()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content' })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void, onPending?: () => void }) => {
        options.onPending?.()
      })
      mockHandleImportDSLConfirm.mockImplementation(async (options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })

      renderAppList(true, onSuccess)
      fireEvent.click(screen.getByText('explore.appCard.addToWorkspace'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(fetchAppDetail).toHaveBeenCalledWith('app-basic-id')
      })
      expect(mockHandleImportDSL).toHaveBeenCalledTimes(1)
      expect(await screen.findByTestId('dsl-confirm-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('dsl-confirm'))
      await waitFor(() => {
        expect(mockHandleImportDSLConfirm).toHaveBeenCalledTimes(1)
        expect(onSuccess).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should reset search results when clear icon is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('input-clear'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should render nothing when isError is true', () => {
      mockIsError = true
      mockExploreData = undefined

      const { container } = renderAppList()

      expect(container.innerHTML).toBe('')
    })

    it('should render nothing when data is undefined', () => {
      mockExploreData = undefined

      const { container } = renderAppList()

      expect(container.innerHTML).toBe('')
    })

    it('should reset filter when reset button is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('explore.apps.resetFilter'))

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should close create modal via hide button', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml' })

      renderAppList(true)
      fireEvent.click(screen.getByText('explore.appCard.addToWorkspace'))
      expect(await screen.findByTestId('create-app-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('hide-create'))
      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should close create modal on successful DSL import', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml' })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })

      renderAppList(true)
      fireEvent.click(screen.getByText('explore.appCard.addToWorkspace'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
    })

    it('should cancel DSL confirm modal', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      };
      (fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml' })
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })

      renderAppList(true)
      fireEvent.click(screen.getByText('explore.appCard.addToWorkspace'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(screen.getByTestId('dsl-confirm-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('dsl-cancel'))
      await waitFor(() => {
        expect(screen.queryByTestId('dsl-confirm-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('TryApp Panel', () => {
    it('should open create modal from try app panel', async () => {
      vi.useRealTimers()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList(true)

      fireEvent.click(screen.getByText('explore.appCard.try'))
      expect(screen.getByTestId('try-app-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('try-app-create'))

      await waitFor(() => {
        expect(screen.getByTestId('create-app-modal')).toBeInTheDocument()
      })
    })

    it('should close try app panel when close is clicked', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList(true)

      fireEvent.click(screen.getByText('explore.appCard.try'))
      expect(screen.getByTestId('try-app-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('try-app-close'))
      expect(screen.queryByTestId('try-app-panel')).not.toBeInTheDocument()
    })
  })

  describe('Banner', () => {
    it('should render banner when enable_explore_banner is true', () => {
      useGlobalPublicStore.setState({
        systemFeatures: {
          ...useGlobalPublicStore.getState().systemFeatures,
          enable_explore_banner: true,
        },
      })
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderAppList()

      expect(screen.getByTestId('explore-banner')).toBeInTheDocument()
    })
  })
})
