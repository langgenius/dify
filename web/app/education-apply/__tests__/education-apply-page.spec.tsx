import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plan } from '@/app/components/billing/type'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'

let mockProviderContext: Record<string, unknown> = {}
let mockConsoleState: Record<string, unknown> = {}
const mockFetchSubscriptionUrls = vi.hoisted(() => vi.fn())
const mockEducationAdd = vi.hoisted(() => vi.fn())

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContext,
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=education-token'),
}))

vi.mock('@/service/billing', () => ({
  fetchSubscriptionUrls: (...args: unknown[]) => mockFetchSubscriptionUrls(...args),
}))

vi.mock('@/service/use-education', () => ({
  useEducationAdd: () => ({ isPending: false, mutateAsync: mockEducationAdd }),
  useInvalidateEducationStatus: () => vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

vi.mock('@/app/education-apply/storage', () => ({
  useSetEducationVerifying: () => vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: {
        get: vi.fn().mockResolvedValue({ url: 'https://billing.example.com' }),
      },
    },
  },
  consoleQuery: {
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
          queryFn: async () => ({ workspaces: [] }),
        }),
      },
      switch: {
        post: {
          mutationOptions: () => ({ mutationFn: vi.fn() }),
        },
      },
    },
  },
}))

const setupContext = (isCurrentWorkspaceManager: boolean) => {
  mockProviderContext = {
    plan: { type: Plan.sandbox },
    isEducationAccount: true,
    onPlanInfoChanged: vi.fn(),
  }
  mockConsoleState = {
    currentWorkspace: { id: 'workspace-1', name: 'Workspace' },
    isCurrentWorkspaceManager,
    userProfile: {
      name: 'Student',
      email: 'student@university.edu',
      avatar_url: '',
    },
  }
}

const renderPage = () => {
  const { wrapper } = createConsoleQueryWrapper()
  return render(<EducationApplyPage />, {
    wrapper,
  })
}

describe('EducationApplyPage billing boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    mockFetchSubscriptionUrls.mockResolvedValue({ url: window.location.href })
  })

  it('lets workspace managers apply the education coupon at checkout', async () => {
    setupContext(true)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

    await waitFor(() => {
      expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'year')
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
})
