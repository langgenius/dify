import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { Plan } from '@/app/components/billing/type'
import AccountDropdown from '@/app/components/header/account-dropdown'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'

const {
  mockAppContextState,
  mockPush,
  mockLogout,
  mockResetUser,
  mockSetShowAccountSettingModal,
} = vi.hoisted(() => ({
  mockAppContextState: {
    userProfile: {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatar: '',
      avatar_url: '',
      is_password_set: true,
    },
    langGeniusVersionInfo: {
      current_env: 'CLOUD',
      current_version: '1.0.0',
      latest_version: '1.1.0',
      release_date: '',
      release_notes: 'https://example.com/releases/1.1.0',
      version: '1.0.0',
      can_auto_update: false,
    },
    isCurrentWorkspaceOwner: false,
  },
  mockPush: vi.fn(),
  mockLogout: vi.fn(),
  mockResetUser: vi.fn(),
  mockSetShowAccountSettingModal: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return ({
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string, version?: string }) => {
        if (options?.version)
          return `${options.ns}.${key}:${options.version}`
        return options?.ns ? `${options.ns}.${key}` : key
      }),
    }),
  })
})

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    isEducationAccount: false,
    plan: {
      type: Plan.professional,
    },
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/service/use-common', async importOriginal => ({
  ...await importOriginal<typeof import('@/service/use-common')>(),
  useLogout: () => ({
    mutateAsync: mockLogout,
  }),
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({
  resetUser: mockResetUser,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const renderAccountDropdown = () => {
  return renderWithSystemFeatures(<AccountDropdown />, {
    systemFeatures: {
      branding: {
        enabled: false,
        workspace_logo: '',
      },
    },
  })
}

describe('Header Account Dropdown Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      repo: { stars: 123456 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    localStorage.clear()
  })

  it('opens account actions, fetches github stars, and opens the settings and about flows', async () => {
    renderAccountDropdown()

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(await screen.findByText('123,456')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.userProfile.settings'))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.MEMBERS,
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))
    fireEvent.click(screen.getByText('common.userProfile.about'))

    await waitFor(() => {
      expect(screen.getByText(/Version/)).toBeInTheDocument()
      expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument()
    })
  })

  it('logs out, resets cached user markers, and redirects to signin', async () => {
    localStorage.setItem('education-reverify-prev-expire-at', '1')
    localStorage.setItem('education-reverify-has-noticed', '1')
    localStorage.setItem('education-expired-has-noticed', '1')

    renderAccountDropdown()

    fireEvent.click(screen.getByRole('button', { name: 'common.account.account' }))
    fireEvent.click(screen.getByText('common.userProfile.logout'))

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1)
      expect(mockResetUser).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })

    expect(localStorage.getItem('education-reverify-prev-expire-at')).toBeNull()
    expect(localStorage.getItem('education-reverify-has-noticed')).toBeNull()
    expect(localStorage.getItem('education-expired-has-noticed')).toBeNull()
  })
})
