import type { AccessPointAppInfo } from '../utils'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { render } from '@/test/console/render'
import { AppModeEnum } from '@/types/app'
import { WebAppAccessPointCard } from '../web-app-card'

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useAppWhiteListSubjects: () => ({
    data: undefined,
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-label="app-icon" />,
}))

vi.mock('@/app/components/app/app-access-control', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/customize', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/settings', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/overview/embedded', () => ({
  default: ({ isShow }: { isShow: boolean }) =>
    isShow ? <div role="dialog" aria-label="embed into site" /> : null,
}))

function createAppInfo(mode: AppModeEnum): AccessPointAppInfo {
  return {
    access_mode: AccessMode.PUBLIC,
    api_base_url: 'https://api.example.test/v1',
    enable_site: true,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    icon_url: null,
    id: 'app-1',
    mode,
    site: {
      access_token: 'site-code',
      app_base_url: 'https://site.example.test',
    },
  } as AccessPointAppInfo
}

function renderCard(mode: AppModeEnum) {
  render(
    <WebAppAccessPointCard
      appInfo={createAppInfo(mode)}
      availability="available"
      canEdit
      canDeploy
      canManageAccess
      showAccessControl={false}
      onChangeStatus={vi.fn().mockResolvedValue(undefined)}
      onRefreshApp={vi.fn().mockResolvedValue(undefined)}
      onRegenerate={vi.fn().mockResolvedValue(undefined)}
      onSaveSiteConfig={vi.fn().mockResolvedValue(undefined)}
    />,
  )
}

describe('WebAppAccessPointCard', () => {
  it('does not offer Embed into site for workflow apps', () => {
    renderCard(AppModeEnum.WORKFLOW)

    expect(screen.queryByRole('button', { name: /embedIntoSite/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /customize\.entry/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings\.settings/ })).toBeInTheDocument()
  })

  it('keeps Embed into site for non-workflow Web apps', async () => {
    const user = userEvent.setup()
    renderCard(AppModeEnum.CHAT)

    await user.click(screen.getByRole('button', { name: /embedIntoSite/ }))

    expect(screen.getByRole('dialog', { name: 'embed into site' })).toBeInTheDocument()
  })
})
