import { AuthCategory } from '../../types'
import { getApi } from '../get-api'

it('keeps the legacy credential-info endpoint for tools', () => {
  expect(getApi({ category: AuthCategory.tool, provider: 'test-provider' }).getCredentialInfo).toBe(
    '/workspaces/current/tool-provider/builtin/test-provider/credential/info',
  )
})

it.each([AuthCategory.datasource, AuthCategory.model, AuthCategory.trigger])(
  'does not request legacy credential info for %s',
  (category) => {
    expect(getApi({ category, provider: 'test-provider' }).getCredentialInfo).toBe('')
  },
)
