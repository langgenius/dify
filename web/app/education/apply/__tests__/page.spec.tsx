import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { ORPCError } from '@orpc/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EducationApplyPage from '@/app/education/apply/application-form'
import { toast } from '@/app/notifications'
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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.invoices.get': async () => ({ url: 'https://billing.example.com' }),
      'billing.subscription.get': mockGetSubscription,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.education.autocomplete.get': async () => ({
        curr_page: 0,
        data: [],
        has_next: false,
      }),
      'account.education.post': mockEducationAdd,
      'account.education.get': async () => ({ is_student: true }),
      'workspaces.get': async () => ({ workspaces: mockWorkspaces }),
      'workspaces.switch.post': mockSwitchWorkspace,
    }),
  }
})

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
    vi.resetAllMocks()
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
      expect(mockGetSubscription).toHaveBeenCalledWith(
        { query: { plan: 'professional', interval: 'year' } },
        { context: { silent: true } },
      )
    })
  })

  it('explains a checkout failure by its error code', async () => {
    setupContext(true)
    mockGetSubscription.mockRejectedValue(
      new ORPCError('billing_unavailable', { defined: true, status: 503, message: 'Backend text' }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('billing.errors.unavailable'),
    )
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
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('switch failed')
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
    expect(
      await screen.findByRole('button', { name: 'education.useEducationDiscount' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['education_activate_failed', 400, 'education.activateFailed'],
    ['education_activate_limit', 429, 'education.tooManyAttempts'],
    ['billing_request_in_progress', 429, 'billing.errors.requestInProgress'],
    ['billing_unavailable', 503, 'billing.errors.unavailable'],
    ['billing_operation_failed', 502, 'billing.errors.operationFailed'],
  ])(
    'explains a %s application failure next to the submit button',
    async (code, status, message) => {
      setupContext(true)
      mockEducationAdd.mockRejectedValue(
        new ORPCError(code, { defined: true, status, message: 'Backend text' }),
      )
      const user = userEvent.setup()
      renderPage(false)

      await user.type(
        screen.getByRole('combobox', { name: 'education.form.schoolName.title' }),
        'DifyUniversity',
      )
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('checkbox', { name: 'education.form.terms.option.age' }))
      await user.click(
        screen.getByRole('checkbox', { name: 'education.form.terms.option.inSchool' }),
      )
      await user.click(
        screen.getByRole('checkbox', { name: 'education.form.terms.option.personalUse' }),
      )
      await user.click(screen.getByRole('button', { name: 'education.submit' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.queryByText('Backend text')).not.toBeInTheDocument()
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'education.submit' })).toBeInTheDocument()
    },
  )
})
