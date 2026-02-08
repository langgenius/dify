import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExploreContext from '@/context/explore-context'
import { fetchAppDetail } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import AppList from './index'

const allCategoriesEn = 'explore.apps.allCategories:{"lng":"en"}'
let mockTabValue = allCategoriesEn
const mockSetTab = vi.fn()
let mockExploreData: { categories: string[], allList: App[] } | undefined = { categories: [], allList: [] }
let mockIsLoading = false
let mockIsError = false
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [mockTabValue, mockSetTab],
  }
})

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => void) => {
      const fnRef = React.useRef(fn)
      fnRef.current = fn
      return {
        run: () => setTimeout(() => fnRef.current(), 0),
      }
    },
  }
})

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

const renderWithContext = (hasEditPermission = false, onSuccess?: () => void) => {
  return render(
    <ExploreContext.Provider
      value={{
        controlUpdateInstalledApps: 0,
        setControlUpdateInstalledApps: vi.fn(),
        hasEditPermission,
        installedApps: [],
        setInstalledApps: vi.fn(),
        isFetchingInstalledApps: false,
        setIsFetchingInstalledApps: vi.fn(),
        isShowTryAppPanel: false,
        setShowTryAppPanel: vi.fn(),
      }}
    >
      <AppList onSuccess={onSuccess} />
    </ExploreContext.Provider>,
  )
}

describe('AppList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTabValue = allCategoriesEn
    mockExploreData = { categories: [], allList: [] }
    mockIsLoading = false
    mockIsError = false
  })

  // Rendering: show loading when categories are not ready.
  describe('Rendering', () => {
    it('should render loading when the query is loading', () => {
      // Arrange
      mockExploreData = undefined
      mockIsLoading = true

      // Act
      renderWithContext()

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render app cards when data is available', () => {
      // Arrange
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, category: 'Translate' })],
      }

      // Act
      renderWithContext()

      // Assert
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })
  })

  // Props: category selection filters the list.
  describe('Props', () => {
    it('should filter apps by selected category', () => {
      // Arrange
      mockTabValue = 'Writing'
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Beta' }, category: 'Translate' })],
      }

      // Act
      renderWithContext()

      // Assert
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
  })

  // User interactions: search and create flow.
  describe('User Interactions', () => {
    it('should filter apps by search keywords', async () => {
      // Arrange
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderWithContext()

      // Act
      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
        expect(screen.getByText('Gamma')).toBeInTheDocument()
      })
    })

    it('should handle create flow and confirm DSL when pending', async () => {
      // Arrange
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

      // Act
      renderWithContext(true, onSuccess)
      fireEvent.click(screen.getByText('explore.appCard.addToWorkspace'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      // Assert
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

  // Edge cases: handle clearing search keywords.
  describe('Edge Cases', () => {
    it('should reset search results when clear icon is clicked', async () => {
      // Arrange
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp(), createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } })],
      }
      renderWithContext()

      // Act
      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'gam' } })
      await waitFor(() => {
        expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('input-clear'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Alpha')).toBeInTheDocument()
        expect(screen.getByText('Gamma')).toBeInTheDocument()
      })
    })
  })
})
