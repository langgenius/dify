import type { PluginPayload } from '../types'
import { AuthCategory } from '../types'

export const getApi = ({ category = AuthCategory.tool, provider }: PluginPayload) => ({
  getCredentialInfo:
    category === AuthCategory.tool
      ? `/workspaces/current/tool-provider/builtin/${provider}/credential/info`
      : '',
})
