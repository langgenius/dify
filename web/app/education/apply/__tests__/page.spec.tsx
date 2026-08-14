import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EducationApplyPage from '@/app/education/apply/application-form'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'

let mockConsoleState: Record<string, unknown> = {}
const mockGetSubscription = vi.hoisted(() => vi.fn())
const mockEducationAdd = vi.hoisted(() => vi.fn())
const mockSwitchWorkspace = vi.hoisted(() => vi.fn())
const mockWorkspaces = vi.hoisted(() => [
  {
    id: 'workspace-1',
    name: 'Workspace One',
    current: true,
    plan: 'sandbox',
  },
  {
    id: 'workspace-2',
    name: 'Workspace Two',
    current: false,
    plan: 'sandbox',
  },
])

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: {
        get: vi.fn().mockResolvedValue({ url: 'https://billing.example.com' }),
      },
      subscription: { get: mockGetSubscription },
    },
  },
  consoleQuery: {
    features: {
      get: {
        queryKey: () => ['features'],
      },
    },
    account: {
      profile: {
        get: {
          queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
        },
      },
      education: {
        autocomplete: {
          get: {
            infiniteOptions: (options: Record<string, unknown>) => ({
              queryKey: ['account', 'education', 'autocomplete'],
              queryFn: async () => ({ data: [], has_next: false }),
              ...options,
            }),
          },
        },
        get: {
          key: () => ['account', 'education'],
          queryOptions: (options: Record<string, unknown> = {}) => ({
            queryKey: ['account', 'education'],
            ...options,
          }),
        },
        post: {
          mutationOptions: () => ({ mutationFn: mockEducationAdd }),
        },
      },
    },
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['system-features'],
          ...options,
        }),
      },
    },
    workspaces: {
      get: {
        queryOptions: () => ({
          queryKey: ['workspaces'],
          queryFn: async () => ({ workspaces: mockWorkspaces }),
        }),
      },
      switch: {
        post: {
          mutationOptions: () => ({ mutationFn: mockSwitchWorkspace }),
        },
      },
    },
  },
}))

const setupContext = (isCurrentWorkspaceManager: boolean) => {
  mockConsoleState = {
    currentWorkspace: { id: 'workspace-1', name: 'Workspace One' },
    isCurrentWorkspaceManager,
    userProfile: {
      name: 'Student',
      email: 'student@university.edu',
      avatar_url: '',
    },
  }
}

const renderPage = (isEducationAccount = true) => {
  const { wrapper } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile as Partial<GetAccountProfileResponse>,
    educationStatus: { is_student: isEducationAccount },
    workspacePermissionKeys: null,
  })
  return render(<EducationApplyPage token="education-token" plan="sandbox" />, {
    wrapper,
  })
}

describe('EducationApplyPage billing boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    mockGetSubscription.mockResolvedValue({ url: window.location.href })
    mockSwitchWorkspace.mockResolvedValue(undefined)
    vi.stubGlobal('location', {
      href: 'https://console.example.com/education/apply?token=education-token',
      reload: vi.fn(),
    } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets workspace managers apply the education coupon at checkout', async () => {
    setupContext(true)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

    await waitFor(() => {
      expect(mockGetSubscription).toHaveBeenCalledWith({
        query: { plan: 'professional', interval: 'year' },
      })
    })
  })

  it('shows non-manager members that they cannot apply the coupon to payment', () => {
    setupContext(false)
    renderPage()

    expect(
      screen.getByText('education.applied.noPaymentPermission.description'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'education.useEducationDiscount' }),
    ).not.toBeInTheDocument()
  })

  it('reloads the current URL after switching workspaces', async () => {
    setupContext(true)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /Workspace Two/ }))

    await waitFor(() => {
      expect(mockSwitchWorkspace.mock.calls[0]?.[0]).toEqual({
        body: { tenant_id: 'workspace-2' },
      })
      expect(globalThis.location.reload).toHaveBeenCalledTimes(1)
    })
  })

  it('disables workspace selection while switching and recovers after a failure', async () => {
    setupContext(true)
    let rejectSwitch!: (error: Error) => void
    mockSwitchWorkspace.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSwitch = reject
        }),
    )
    const user = userEvent.setup()
    renderPage()

    const selector = await screen.findByRole('combobox')
    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: /Workspace Two/ }))

    await waitFor(() => {
      expect(selector).toBeDisabled()
    })

    rejectSwitch(new Error('switch failed'))

    await waitFor(() => {
      expect(selector).toBeEnabled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
    expect(globalThis.location.reload).not.toHaveBeenCalled()
  })

  it('requires every education agreement before submitting an application', async () => {
    setupContext(true)
    mockEducationAdd.mockResolvedValue({ message: 'success' })
    const user = userEvent.setup()
    renderPage(false)

    const submitButton = screen.getByRole('button', { name: 'education.submit' })
    await user.type(
      screen.getByRole('combobox', { name: 'education.form.schoolName.title' }),
      'DifyUniversity',
    )
    await user.keyboard('{Escape}')
    expect(
      screen.getByRole('radiogroup', { name: 'education.form.schoolRole.title' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'education.form.schoolRole.option.student' }),
    ).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'education.form.terms.option.age' }))
    await user.click(screen.getByRole('checkbox', { name: 'education.form.terms.option.inSchool' }))

    expect(submitButton).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', { name: 'education.form.terms.option.personalUse' }),
    )

    expect(submitButton).toBeEnabled()

    await user.click(submitButton)

    await waitFor(() => {
      expect(mockEducationAdd.mock.calls[0]?.[0]).toEqual({
        body: {
          token: 'education-token',
          role: 'Student',
          institution: 'DifyUniversity',
        },
      })
    })
  })
})
