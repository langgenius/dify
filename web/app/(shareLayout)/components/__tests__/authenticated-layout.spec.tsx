import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useWebAppStore } from '@/context/web-app-context'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { useGetWebAppInfo, useGetWebAppMeta, useGetWebAppParams } from '@/service/use-share'
import AuthenticatedLayout from '../authenticated-layout'

const mockReplace = vi.fn()
const mockShareCode = 'share-code'
const mockUpdateAppInfo = vi.fn()
const mockUpdateAppParams = vi.fn()
const mockUpdateWebAppMeta = vi.fn()
const mockUpdateUserCanAccessApp = vi.fn()

const mockAppInfo = {
  app_id: 'app-123',
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/chat/test-share-code',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: vi.fn(),
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: vi.fn(),
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppInfo: vi.fn(),
  useGetWebAppParams: vi.fn(),
  useGetWebAppMeta: vi.fn(),
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
}))

describe('AuthenticatedLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(useWebAppStore as unknown as Mock).mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        shareCode: mockShareCode,
        updateAppInfo: mockUpdateAppInfo,
        updateAppParams: mockUpdateAppParams,
        updateWebAppMeta: mockUpdateWebAppMeta,
        updateUserCanAccessApp: mockUpdateUserCanAccessApp,
      }
      return selector(state)
    })

    ;(useGetWebAppInfo as Mock).mockReturnValue({
      data: mockAppInfo,
      error: null,
      isPending: false,
    })

    ;(useGetWebAppParams as Mock).mockReturnValue({
      data: { user_input_form: [] },
      error: null,
      isPending: false,
    })

    ;(useGetWebAppMeta as Mock).mockReturnValue({
      data: { tool_icons: {} },
      error: null,
      isPending: false,
    })

    ;(useGetUserCanAccessApp as Mock).mockReturnValue({
      data: { result: true },
      error: null,
      isPending: false,
    })
  })

  describe('Permission Gating', () => {
    it('should not render children while the app info needed for permission is still pending', () => {
      ;(useGetWebAppInfo as Mock).mockReturnValue({
        data: undefined,
        error: null,
        isPending: true,
      })

      render(
        <AuthenticatedLayout>
          <div>protected child</div>
        </AuthenticatedLayout>,
      )

      expect(screen.queryByText('protected child')).not.toBeInTheDocument()
    })

    it('should not render children while the access check is still pending', () => {
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: undefined,
        error: null,
        isPending: true,
      })

      render(
        <AuthenticatedLayout>
          <div>protected child</div>
        </AuthenticatedLayout>,
      )

      expect(screen.queryByText('protected child')).not.toBeInTheDocument()
    })

    it('should render children once access is allowed even if metadata queries are still pending', () => {
      ;(useGetWebAppParams as Mock).mockReturnValue({
        data: undefined,
        error: null,
        isPending: true,
      })

      ;(useGetWebAppMeta as Mock).mockReturnValue({
        data: undefined,
        error: null,
        isPending: true,
      })

      render(
        <AuthenticatedLayout>
          <div>protected child</div>
        </AuthenticatedLayout>,
      )

      expect(screen.getByText('protected child')).toBeInTheDocument()
    })

    it('should render the no permission state when access is denied', () => {
      ;(useGetUserCanAccessApp as Mock).mockReturnValue({
        data: { result: false },
        error: null,
        isPending: false,
      })

      render(
        <AuthenticatedLayout>
          <div>protected child</div>
        </AuthenticatedLayout>,
      )

      expect(screen.queryByText('protected child')).not.toBeInTheDocument()
      expect(screen.getByText(/403/)).toBeInTheDocument()
      expect(screen.getByText(/no permission/i)).toBeInTheDocument()
    })
  })
})
