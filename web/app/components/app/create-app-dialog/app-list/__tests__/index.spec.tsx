import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { trackEvent } from '@/app/components/base/amplitude'
import { AppModeEnum } from '@/types/app'
import Apps from '../index'

type ImportCallbacks = {
  onSuccess?: () => void
  onPending?: () => void
}

type ConfirmCallbacks = {
  onSuccess?: () => void
}

const mockUseExploreAppList = vi.fn()
const mockHandleImportDSL
  = vi.fn<(payload: Record<string, unknown>, callbacks: ImportCallbacks) => Promise<void>>()
const mockHandleImportDSLConfirm = vi.fn<(callbacks: ConfirmCallbacks) => Promise<void>>()
let mockIsFetching = false

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
vi.mock('@/service/use-explore', () => ({
  useExploreAppList: () => mockUseExploreAppList(),
}))
vi.mock('@/app/components/app/type-selector', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: AppModeEnum[]
    onChange: (value: AppModeEnum[]) => void
  }) => (
    <button type="button" aria-label="Select app type" onClick={() => onChange([...value, 'chat' as AppModeEnum])}>
      {value.join(',')}
    </button>
  ),
}))
vi.mock('@/app/components/app/create-app-dialog/app-card', () => ({
  default: ({ app, onCreate }: { app: App, onCreate: () => void }) => (
    <button type="button" aria-label={`Use ${app.app.name} template`} onClick={onCreate}>
      {app.app.name}
    </button>
  ),
}))
vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: (props: CreateAppModalProps) => {
    if (!props.show)
      return null

    return (
      <div role="dialog" aria-label="Create app from template">
        <button
          type="button"
          disabled={props.confirmDisabled}
          onClick={() => {
            void props.onConfirm({
              name: 'Created from template',
              icon_type: 'emoji',
              icon: '🙂',
              icon_background: '#000',
              description: 'Created description',
            })
            props.onHide()
          }}
        >
          Create
        </button>
      </div>
    )
  },
}))
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))
vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn().mockResolvedValue({
    export_data: 'dsl',
    mode: 'chat',
  }),
}))
vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: mockHandleImportDSL,
    handleImportDSLConfirm: mockHandleImportDSLConfirm,
    versions: {
      importedVersion: '0.7.0',
      systemVersion: '0.6.0',
    },
    isFetching: mockIsFetching,
  }),
}))
vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({
    confirmDisabled,
    onCancel,
    onConfirm,
  }: {
    confirmDisabled?: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => (
    <div role="dialog" aria-label="Confirm DSL version">
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" disabled={confirmDisabled} onClick={onConfirm}>
        Confirm
      </button>
    </div>
  ),
}))

const createAppEntry = (name: string, category: App['category']): App => ({
  app_id: name,
  category,
  app: {
    id: name,
    name,
    icon_type: 'emoji',
    icon: '🙂',
    icon_background: '#000',
    icon_url: '',
    description: 'desc',
    mode: AppModeEnum.CHAT,
    use_icon_as_answer_icon: false,
  },
  description: 'desc',
  copyright: '',
  privacy_policy: null,
  custom_disclaimer: null,
  position: 0,
  is_listed: true,
  install_count: 0,
  installed: false,
  editable: false,
  is_agent: false,
  can_trial: false,
})

describe('Apps', () => {
  const defaultData = {
    allList: [createAppEntry('Alpha', 'Writing'), createAppEntry('Bravo', 'Translate')],
    categories: ['Writing', 'Translate'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFetching = false
    mockHandleImportDSL.mockImplementation(
      async (_payload: Record<string, unknown>, { onPending }: ImportCallbacks) => {
        onPending?.()
      },
    )
    mockUseExploreAppList.mockReturnValue({
      data: defaultData,
      isLoading: false,
    })
  })

  it('renders template cards when data is available', () => {
    render(<Apps />)

    expect(screen.getAllByRole('button', { name: /template/ })).toHaveLength(2)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('opens create modal when a template card is clicked', () => {
    render(<Apps />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))
    expect(screen.getByRole('dialog', { name: 'Create app from template' })).toBeInTheDocument()
  })

  it('shows version confirmation when template import is pending', async () => {
    render(<Apps />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mockHandleImportDSL).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('dialog', { name: 'Confirm DSL version' })).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith('create_app_with_template', {
      app_mode: 'chat',
      template_id: 'Alpha',
      template_name: 'Alpha',
      description: 'Created description',
    })
  })

  it('confirms a pending template import before reporting success', async () => {
    const onSuccess = vi.fn()
    mockHandleImportDSLConfirm.mockImplementation(async ({ onSuccess }: ConfirmCallbacks) => {
      onSuccess?.()
    })
    render(<Apps onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(mockHandleImportDSLConfirm).toHaveBeenCalledTimes(1)
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Confirm DSL version' })).not.toBeInTheDocument()
  })

  it('closes version confirmation when the user cancels', async () => {
    render(<Apps />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Confirm DSL version' })).not.toBeInTheDocument()
    expect(mockHandleImportDSLConfirm).not.toHaveBeenCalled()
  })

  it('reports success immediately when the template import completes', async () => {
    const onSuccess = vi.fn()
    mockHandleImportDSL.mockImplementation(
      async (_payload: Record<string, unknown>, { onSuccess }: ImportCallbacks) => {
        onSuccess?.()
      },
    )
    render(<Apps onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('dialog', { name: 'Confirm DSL version' })).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('disables template creation while an import is in progress', () => {
    mockIsFetching = true
    render(<Apps />)

    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha template' }))

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
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
