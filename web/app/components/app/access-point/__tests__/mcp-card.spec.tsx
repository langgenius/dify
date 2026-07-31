import type { ReactElement } from 'react'
import type { AccessPointAppInfo } from '../utils'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppModeEnum } from '@/types/app'
import { MCPAccessPointCard } from '../mcp-card'

const mocks = vi.hoisted(() => ({
  invalidateServerDetail: vi.fn(),
  refreshServerCode: vi.fn(),
  updateServer: vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateMCPServerDetail: () => mocks.invalidateServerDetail,
  useMCPServerDetail: () => ({
    data: {
      description: '',
      id: 'mcp-server-1',
      parameters: {},
      server_code: 'server-code',
      status: 'active',
    },
    isPending: false,
  }),
  useRefreshMCPServerCode: () => ({
    isPending: false,
    mutateAsync: mocks.refreshServerCode,
  }),
  useUpdateMCPServer: () => ({
    isPending: false,
    mutateAsync: mocks.updateServer,
  }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: () =>
    Promise.resolve({
      model_config: {
        updated_at: '2026-07-31T00:00:00Z',
        user_input_form: [],
      },
    }),
}))

vi.mock('@/app/components/tools/mcp/mcp-server-modal', () => ({
  default: () => null,
}))

const appInfo = {
  access_mode: AccessMode.PUBLIC,
  api_base_url: 'https://api.example.test/v1',
  enable_site: true,
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_type: 'emoji',
  icon_url: null,
  id: 'app-1',
  mode: AppModeEnum.CHAT,
  site: {
    access_token: 'site-code',
    app_base_url: 'https://site.example.test',
  },
} as AccessPointAppInfo

function renderCard(ui: ReactElement) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>)
}

describe('MCPAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshServerCode.mockResolvedValue(undefined)
  })

  it('regenerates the server code using the app id', async () => {
    const user = userEvent.setup()
    renderCard(
      <MCPAccessPointCard
        appInfo={appInfo}
        canEdit
        triggerModeDisabled={false}
        workflow={undefined}
        workflowLoading={false}
      />,
    )

    await user.click(await screen.findByRole('button', { name: /regenerate/ }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))

    await waitFor(() => {
      expect(mocks.refreshServerCode).toHaveBeenCalledWith('app-1')
    })
    expect(mocks.invalidateServerDetail).toHaveBeenCalledWith('app-1')
  })
})
