import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceSettings } from '@/service/common'
import UsageLimitsPage from '../index'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/context/app-context')
vi.mock('@/service/common')
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}))

const mutateCurrentWorkspace = vi.fn()

const createWorkspace = (overrides: Partial<ICurrentWorkspace> = {}): ICurrentWorkspace => ({
  id: 'workspace-id',
  name: 'Test Workspace',
  plan: 'basic',
  status: 'normal',
  created_at: 0,
  role: 'owner',
  providers: [],
  trial_credits: 0,
  trial_credits_used: 0,
  next_credit_reset_date: 0,
  max_active_requests: 5,
  ...overrides,
})

const mockAppContext = (overrides: Partial<AppContextValue> = {}) => {
  vi.mocked(useAppContext).mockReturnValue({
    currentWorkspace: createWorkspace(),
    isCurrentWorkspaceManager: true,
    isValidatingCurrentWorkspace: false,
    mutateCurrentWorkspace,
    ...overrides,
  } as AppContextValue)
}

const renderUsageLimitsPage = () => render(<UsageLimitsPage />)

const getLimitInput = () => screen.getByRole('spinbutton', {
  name: /usageLimits\.maxActiveRequests\.label/i,
})

const getSaveButton = () => screen.getByRole('button', { name: /operation\.(save|saving)/i })

describe('UsageLimitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContext()
    vi.mocked(updateWorkspaceSettings).mockResolvedValue({
      result: 'success',
      tenant: createWorkspace(),
    })
  })

  describe('Rendering', () => {
    it('should render the current workspace active request limit', () => {
      renderUsageLimitsPage()

      expect(screen.getByText('common.usageLimits.requestConcurrency.title')).toBeInTheDocument()
      expect(getLimitInput()).toHaveValue(5)
    })
  })

  describe('Permissions', () => {
    it('should disable editing when the current user cannot manage the workspace', () => {
      mockAppContext({
        currentWorkspace: createWorkspace({ role: 'normal' }),
        isCurrentWorkspaceManager: false,
      })

      renderUsageLimitsPage()

      expect(getLimitInput()).toBeDisabled()
      expect(getSaveButton()).toBeDisabled()
    })
  })

  describe('Saving', () => {
    it('should save max active requests with the current workspace name', async () => {
      const user = userEvent.setup()
      renderUsageLimitsPage()

      await user.clear(getLimitInput())
      await user.type(getLimitInput(), '12')
      await user.click(getSaveButton())

      await waitFor(() => {
        expect(updateWorkspaceSettings).toHaveBeenCalledWith({
          name: 'Test Workspace',
          max_active_requests: 12,
        })
      })
      expect(mutateCurrentWorkspace).toHaveBeenCalled()
      expect(toastMocks.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
    })

    it('should reject negative values before saving', async () => {
      const user = userEvent.setup()
      renderUsageLimitsPage()

      await user.clear(getLimitInput())
      await user.type(getLimitInput(), '-1')

      expect(getSaveButton()).toBeDisabled()
      expect(updateWorkspaceSettings).not.toHaveBeenCalled()
    })

    it('should show an error toast when saving fails', async () => {
      const user = userEvent.setup()
      vi.mocked(updateWorkspaceSettings).mockRejectedValue(new Error('update failed'))
      renderUsageLimitsPage()

      await user.clear(getLimitInput())
      await user.type(getLimitInput(), '8')
      await user.click(getSaveButton())

      await waitFor(() => {
        expect(toastMocks.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
      })
    })
  })
})
