import type { AppNetworkAccessGroupStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { toast } from '@/app/notifications'
import deploymentTranslations from '@/i18n/locales/en-US/deployments.json'
import { consoleQuery } from '@/service/console'
import { clearRequestErrorToasts } from '@/service/request-error-toast'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AccessControlEntry } from '..'

vi.unmock('react-i18next')
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const statusPath = '/apps/app-1/network-access-group/status'
const requests: Request[] = []

const createStatus = (
  overrides: Partial<AppNetworkAccessGroupStatusResponse> = {},
): AppNetworkAccessGroupStatusResponse => ({
  entitled: true,
  configured: true,
  enabled: true,
  covered_count: 3,
  available_count: 3,
  ...overrides,
})

const renderNormalEntry = (response: () => Response) => {
  const queryClient = createConsoleQueryClient()
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    if (new URL(request.url).pathname.endsWith(statusPath) && request.method === 'GET')
      return response()
    return Response.json({ message: 'Unexpected privileged request' }, { status: 403 })
  })

  // Only workspace/edition metadata is seeded. The status must cross the real
  // Console transport, without configuration or policy-list data in the cache.
  return renderWithConsoleQuery(
    <AccessControlEntry
      appMode="chat"
      appId="app-1"
      appIcon={null}
      isPublished
      canEditBinding={false}
    />,
    {
      queryClient,
      currentWorkspace: { role: 'normal' },
      systemFeatures: { deployment_edition: 'CLOUD' },
    },
  )
}

const expectOnlyStatusRequest = () => {
  expect(requests).toHaveLength(1)
  expect(requests[0]!.method).toBe('GET')
  expect(new URL(requests[0]!.url).pathname).toBe(`/console/api${statusPath}`)
}

beforeEach(async () => {
  requests.length = 0
  vi.mocked(toast.error).mockClear()
  await createInstance()
    .use(initReactI18next)
    .init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      keySeparator: false,
      interpolation: { escapeValue: false },
      resources: { 'en-US': { deployments: deploymentTranslations } },
    })
})

afterEach(() => {
  for (const request of requests) clearRequestErrorToasts(request)
})

describe('Normal member Access Control status', () => {
  it.each([
    {
      name: 'Off',
      status: createStatus({ configured: false, enabled: false, covered_count: 0 }),
      label: 'Off',
    },
    { name: 'Paused', status: createStatus({ enabled: false }), label: 'Pause' },
    { name: 'On', status: createStatus(), label: 'ON' },
    { name: 'partial coverage', status: createStatus({ covered_count: 2 }), label: '2 of 3' },
    { name: 'downgraded', status: createStatus({ entitled: false }), label: 'PRO' },
  ])(
    'loads $name from the status-only API without exposing configuration',
    async ({ status, label }) => {
      const user = userEvent.setup()
      renderNormalEntry(() => Response.json(status))

      expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
      const entry = await screen.findByRole('button', { name: /Access Control/ })
      expect(entry).toBeDisabled()
      expect(entry).toHaveTextContent(label)

      await user.click(entry)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('switch', { name: 'Restrict by IP address' }),
      ).not.toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
      expectOnlyStatusRequest()
    },
  )

  it.each([403, 503])(
    'does not show a false Off state or fetch configuration after HTTP %s',
    async (status) => {
      const message = status === 403 ? 'Access denied' : 'Service unavailable'
      const rendered = renderNormalEntry(() => Response.json({ message }, { status }))

      await waitFor(() => {
        expect(
          rendered.queryClient.getQueryState(
            consoleQuery.apps.byAppId.networkAccessGroup.status.get.queryKey({
              input: { params: { app_id: 'app-1' } },
            }),
          )?.status,
        ).toBe('error')
      })
      expect(screen.queryByRole('button', { name: /Access Control/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
      expectOnlyStatusRequest()
    },
  )
})
