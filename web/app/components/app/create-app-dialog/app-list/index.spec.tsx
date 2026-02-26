import { fireEvent, render, screen } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import Apps from './index'

const mockUseExploreAppList = vi.fn()

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: () => void) => ({
    run: () => setTimeout(fn, 0),
    cancel: vi.fn(),
    flush: () => fn(),
  }),
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
    <button data-testid="type-selector" onClick={() => onChange([...value, 'chat' as AppModeEnum])}>{value.join(',')}</button>
  ),
}))
vi.mock('../app-card', () => ({
  default: ({ app, onCreate }: { app: any, onCreate: () => void }) => (
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
  default: () => <div data-testid="create-from-template-modal" />,
}))
vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))
vi.mock('@/service/apps', () => ({
  importDSL: vi.fn().mockResolvedValue({ app_id: '1' }),
}))
vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn().mockResolvedValue({
    export_data: 'dsl',
    mode: 'chat',
  }),
}))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: vi.fn(),
  }),
}))
vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const createAppEntry = (name: string, category: string) => ({
  app_id: name,
  category,
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
    ],
    categories: ['Cat A', 'Cat B'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseExploreAppList.mockReturnValue({
      data: defaultData,
      isLoading: false,
    })
  })

  it('renders template cards when data is available', () => {
    render(<Apps />)

    expect(screen.getAllByTestId('app-card')).toHaveLength(2)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('opens create modal when a template card is clicked', () => {
    render(<Apps />)

    fireEvent.click(screen.getAllByTestId('app-card')[0])
    expect(screen.getByTestId('create-from-template-modal')).toBeInTheDocument()
  })

  it('shows no template message when list is empty', () => {
    mockUseExploreAppList.mockReturnValueOnce({
      data: { allList: [], categories: [] },
      isLoading: false,
    })

    render(<Apps />)

    expect(screen.getByText('app.newApp.noTemplateFound')).toBeInTheDocument()
    expect(screen.getByText('app.newApp.noTemplateFoundTip')).toBeInTheDocument()
  })
})
