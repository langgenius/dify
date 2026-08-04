import type { AccessPointAppInfo } from '../utils'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { ServiceApiAccessPointCard } from '../service-api-card'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en${path}`,
}))

vi.mock('../api-secret-key-button', () => ({
  ApiSecretKeyButton: () => null,
}))

function createAppInfo(mode: AppModeEnum): AccessPointAppInfo {
  return {
    api_base_url: 'https://api.example.test/v1',
    enable_api: true,
    id: 'app-1',
    mode,
  } as AccessPointAppInfo
}

describe('ServiceApiAccessPointCard', () => {
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
        canEdit
        onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const apiReferenceLink = screen.getByRole('button', { name: /apiInfo\.doc/ })

    expect(apiReferenceLink).toHaveAttribute('href', `https://docs.example.test/en${path}`)
    expect(apiReferenceLink).toHaveAttribute('target', '_blank')
    expect(apiReferenceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
