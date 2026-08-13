import type { AccessPointAppInfo } from '../shared/utils'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { ServiceApiAccessPointCard } from '../built-in-access-points/service-api-card'

const mocks = vi.hoisted(() => ({
  apiSecretKeyButtonProps: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('../shared/api-secret-key-button', () => ({
  ApiSecretKeyButton: (props: { canManage: boolean; disabled?: boolean }) => {
    mocks.apiSecretKeyButtonProps(props)
    return (
      <button type="button" disabled={!props.canManage || props.disabled}>
        api-secret-keys
      </button>
    )
  },
}))

function createAppInfo(
  mode: AppModeEnum,
  overrides: Partial<AccessPointAppInfo> = {},
): AccessPointAppInfo {
  return {
    api_base_url: 'https://api.example.test/v1',
    enable_api: true,
    id: 'app-1',
    mode,
    ...overrides,
  } as AccessPointAppInfo
}

describe('ServiceApiAccessPointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [AppModeEnum.ADVANCED_CHAT, '/api-reference/guides/chatflow'],
    [AppModeEnum.WORKFLOW, '/api-reference/guides/workflow'],
    [AppModeEnum.CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.AGENT_CHAT, '/api-reference/guides/chat'],
    [AppModeEnum.COMPLETION, '/api-reference/guides/completion'],
  ])('links %s apps to the matching external API reference', (mode, path) => {
    render(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(mode)}
        availability="available"
        canManage
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })

    expect(apiReferenceLink).toHaveAttribute('href', `https://docs.example.test/en${path}`)
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows loading without reporting an environment failure', () => {
    render(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="loading"
        canManage
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const card = screen.getByRole('region', { name: /serviceApi\.title/ })
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(
      screen.queryByText('deployments.health.ENVIRONMENT_STATUS_FAILED'),
    ).not.toBeInTheDocument()
  })

  it('keeps API keys and external documentation available when the API is stopped', () => {
    render(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW, { enable_api: false })}
        availability="available"
        canManage
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeEnabled()
    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })
    expect(apiReferenceLink).not.toHaveAttribute('aria-disabled')
    expect(apiReferenceLink).toHaveAttribute(
      'href',
      'https://docs.example.test/en/api-reference/guides/workflow',
    )
  })

  it('disables API management without release permission', () => {
    render(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="available"
        canManage={false}
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables API keys and external documentation when the access point is unavailable', () => {
    render(
      <ServiceApiAccessPointCard
        appInfo={createAppInfo(AppModeEnum.WORKFLOW)}
        availability="unavailable"
        canManage
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('button', { name: 'api-secret-keys' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /apiInfo\.doc/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
