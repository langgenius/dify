import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { AppModeEnum } from '@/types/app'
import Apps from '../index'

const mockUseExploreAppList = vi.fn()
const mockImportDSL = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockGetRedirection = vi.fn()
const mockPush = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockTrackCreateApp = vi.fn()
let latestDebounceFn = () => {}

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: () => void) => {
    latestDebounceFn = fn
    return {
      run: () => setTimeout(() => latestDebounceFn(), 0),
      cancel: vi.fn(),
      flush: () => latestDebounceFn(),
    }
  },
}))
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceEditor: true }),
}))
vi.mock('nuqs', () => ({
  useQueryState: () => ['Recommended', vi.fn()],
}))
vi.mock('@/service/use-explore', () => ({
  useExploreAppList: () => mockUseExploreAppList(),
}))
vi.mock('@/app/components/app/type-selector', () => ({
  default: ({ value, onChange }: { value: AppModeEnum[], onChange: (value: AppModeEnum[]) => void }) => (
    <div>
      <button data-testid="type-selector-chat" onClick={() => onChange([AppModeEnum.CHAT])}>{value.join(',')}</button>
      <button data-testid="type-selector-advanced" onClick={() => onChange([AppModeEnum.ADVANCED_CHAT])}>advanced</button>
      <button data-testid="type-selector-agent" onClick={() => onChange([AppModeEnum.AGENT_CHAT])}>agent</button>
      <button data-testid="type-selector-completion" onClick={() => onChange([AppModeEnum.COMPLETION])}>completion</button>
      <button data-testid="type-selector-workflow" onClick={() => onChange([AppModeEnum.WORKFLOW])}>workflow</button>
    </div>
  ),
}))
vi.mock('../../app-card', () => ({
  default: ({ app, onCreate }: { app: { app: { name: string } }, onCreate: () => void }) => (
    <div
      data-testid="app-card"
      data-name={app.app.name}
      onClick={onCreate}
    >
      {app.app.name}
    </div>
  ),
}))
vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: ({ onConfirm, onHide, show }: {
    onConfirm: (payload: {
      name: string
      icon_type: string
      icon: string
      icon_background: string
      description: string
    }) => Promise<void>
    onHide: () => void
    show: boolean
  }) => show
    ? (
        <div data-testid="create-from-template-modal">
          <button
            data-testid="confirm-create"
            onClick={() => onConfirm({
              name: 'Created App',
              icon_type: 'emoji',
              icon: '🙂',
              icon_background: '#fff',
              description: 'created from template',
            })}
          >
            confirm-create
          </button>
          <button data-testid="hide-create-modal" onClick={onHide}>hide-create-modal</button>
        </div>
      )
    : null,
}))
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))
vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: (...args: unknown[]) => mockTrackCreateApp(...args),
}))
vi.mock('@/service/apps', () => ({
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
}))
vi.mock('@/service/explore', () => ({
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
}))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: (...args: unknown[]) => mockHandleCheckPluginDependencies(...args),
  }),
}))
vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const createAppEntry = (name: string, category: string) => ({
  app_id: name,
  categories: [category],
  app: {
    id: name,
    name,
    icon_type: 'emoji',
    icon: '🙂',
    icon_background: '#000',
    icon_url: null,
    description: 'desc',
    mode: AppModeEnum.CHAT,
  },
})

describe('Apps', () => {
  const defaultData = {
    allList: [
      createAppEntry('Alpha', 'Cat A'),
      createAppEntry('Bravo', 'Cat B'),
      {
        ...createAppEntry('Charlie', 'Cat B'),
        app: {
          ...createAppEntry('Charlie', 'Cat B').app,
          mode: AppModeEnum.COMPLETION,
        },
      },
      {
        ...createAppEntry('Delta', 'Cat A'),
        app: {
          ...createAppEntry('Delta', 'Cat A').app,
          mode: AppModeEnum.ADVANCED_CHAT,
        },
      },
      {
        ...createAppEntry('Echo', 'Cat C'),
        app: {
          ...createAppEntry('Echo', 'Cat C').app,
          mode: AppModeEnum.AGENT_CHAT,
        },
      },
      {
        ...createAppEntry('Foxtrot', 'Cat C'),
        app: {
          ...createAppEntry('Foxtrot', 'Cat C').app,
          mode: AppModeEnum.WORKFLOW,
        },
      },
    ],
    categories: ['Cat A', 'Cat B', 'Cat C'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockUseExploreAppList.mockReturnValue({
      data: defaultData,
      isLoading: false,
    })
    mockFetchAppDetail.mockResolvedValue({
      export_data: 'dsl',
      mode: AppModeEnum.CHAT,
    })
    mockImportDSL.mockResolvedValue({ app_id: 'created-app-id' })
  })

  it('renders template cards when data is available', () => {
    render(<Apps />)

    expect(screen.getAllByTestId('app-card')).toHaveLength(6)
    expect(screen.getByText('Alpha'))!.toBeInTheDocument()
    expect(screen.getByText('Bravo'))!.toBeInTheDocument()
  })

  it('opens create modal when a template card is clicked', () => {
    render(<Apps />)

    fireEvent.click(screen.getAllByTestId('app-card')[0]!)
    expect(screen.getByTestId('create-from-template-modal'))!.toBeInTheDocument()
  })

  it('shows no template message when list is empty', () => {
    mockUseExploreAppList.mockReturnValueOnce({
      data: { allList: [], categories: [] },
      isLoading: false,
    })

    render(<Apps />)

    expect(screen.getByText('app.newApp.noTemplateFound'))!.toBeInTheDocument()
    expect(screen.getByText('app.newApp.noTemplateFoundTip'))!.toBeInTheDocument()
  })

  it('filters templates by keyword and selected app type', async () => {
    render(<Apps />)

    fireEvent.change(screen.getByPlaceholderText('app.newAppFromTemplate.searchAllTemplate'), {
      target: { value: 'Bravo' },
    })

    await waitFor(() => {
      expect(screen.getByText('Bravo'))!.toBeInTheDocument()
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('app.newAppFromTemplate.searchAllTemplate'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId('type-selector-chat'))

    await waitFor(() => {
      expect(screen.getByText('Alpha'))!.toBeInTheDocument()
      expect(screen.getByText('Bravo'))!.toBeInTheDocument()
      expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
    })
  })

  it('creates an app from a template and redirects after import succeeds', async () => {
    const onSuccess = vi.fn()

    render(<Apps onSuccess={onSuccess} />)

    fireEvent.click(screen.getAllByTestId('app-card')[0]!)
    fireEvent.click(screen.getByTestId('confirm-create'))

    await waitFor(() => {
      expect(mockFetchAppDetail).toHaveBeenCalledWith('Alpha')
      expect(mockImportDSL).toHaveBeenCalledWith(expect.objectContaining({
        yaml_content: 'dsl',
        name: 'Created App',
      }))
    })

    expect(mockTrackCreateApp).toHaveBeenCalledWith({
      appMode: AppModeEnum.CHAT,
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('app.newApp.appCreated')
    expect(onSuccess).toHaveBeenCalled()
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('created-app-id')
    expect(localStorage.getItem(NEED_REFRESH_APP_LIST_KEY)).toBe('1')
    expect(mockGetRedirection).toHaveBeenCalledWith(true, {
      id: 'created-app-id',
      mode: AppModeEnum.CHAT,
    }, mockPush)
  })

  it('shows an error toast when importing the template fails', async () => {
    mockImportDSL.mockRejectedValueOnce(new Error('failed'))

    render(<Apps />)

    fireEvent.click(screen.getAllByTestId('app-card')[0]!)
    fireEvent.click(screen.getByTestId('confirm-create'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('app.newApp.appCreateFailed')
    })
  })

  it('forwards the create-from-blank action from the sidebar', () => {
    const onCreateFromBlank = vi.fn()

    render(<Apps onCreateFromBlank={onCreateFromBlank} />)

    fireEvent.click(screen.getByText('app.newApp.startFromBlank'))

    expect(onCreateFromBlank).toHaveBeenCalled()
  })

  it('should render the loading state while templates are being fetched', () => {
    mockUseExploreAppList.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    })

    render(<Apps />)

    expect(screen.getByRole('status'))!.toBeInTheDocument()
  })

  it('should handle an undefined template payload by falling back to the empty state', () => {
    mockUseExploreAppList.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
    })

    render(<Apps />)

    expect(screen.getByText('app.newApp.noTemplateFound'))!.toBeInTheDocument()
  })

  it('should filter templates by category and the remaining app modes', async () => {
    render(<Apps />)

    fireEvent.click(screen.getByText('Cat C'))
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Echo'))!.toBeInTheDocument()
    expect(screen.getByText('Foxtrot'))!.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('type-selector-advanced'))
    await waitFor(() => {
      expect(screen.queryByText('Echo')).not.toBeInTheDocument()
      expect(screen.queryByText('Foxtrot')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
    fireEvent.click(screen.getByText('Cat C'))
    fireEvent.click(screen.getByTestId('type-selector-agent'))
    await waitFor(() => {
      expect(screen.getByText('Echo'))!.toBeInTheDocument()
      expect(screen.queryByText('Foxtrot')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('type-selector-workflow'))
    await waitFor(() => {
      expect(screen.getByText('Foxtrot'))!.toBeInTheDocument()
      expect(screen.queryByText('Echo')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('type-selector-completion'))
    await waitFor(() => {
      expect(screen.queryByText('Foxtrot')).not.toBeInTheDocument()
      expect(screen.queryByText('Echo')).not.toBeInTheDocument()
    })
  })

  it('should clear the search, hide the sidebar during search, and close the modal when requested', async () => {
    render(<Apps />)

    const searchInput = screen.getByPlaceholderText('app.newAppFromTemplate.searchAllTemplate')
    fireEvent.change(searchInput, {
      target: { value: 'Alpha' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Cat A')).not.toBeInTheDocument()
    })

    fireEvent.change(searchInput, {
      target: { value: '' },
    })

    await waitFor(() => {
      expect(screen.getByText('Cat A'))!.toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTestId('app-card')[0]!)
    expect(screen.getByTestId('create-from-template-modal'))!.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('hide-create-modal'))

    expect(screen.queryByTestId('create-from-template-modal')).not.toBeInTheDocument()
  })
})
