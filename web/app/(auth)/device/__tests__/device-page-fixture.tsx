import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import DevicePage from '../page'

export async function renderDevicePage({ signedIn = false, sso = false } = {}) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    accountProfile: signedIn
      ? { name: 'Gareth Chen', email: 'gareth@example.com', avatar_url: null }
      : null,
    currentWorkspace: { name: 'Dify Enterprise' },
    systemFeatures: {
      webapp_auth: { enabled: sso, allow_sso: sso, sso_config: { protocol: sso ? 'saml' : null } },
    },
  })
  const screen = await render(
    <Providers>
      <DevicePage />
    </Providers>,
  )
  return { screen, queryClient }
}
