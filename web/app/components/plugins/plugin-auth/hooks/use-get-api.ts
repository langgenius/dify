import type { CredentialTypeEnum, PluginPayload } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import { AuthCategory } from '../types'

/**
 * Empty URL set returned to `usePluginAuth` whenever the requested route is
 * guaranteed not to exist on the backend.
 *
 * The plugin-auth hooks (credential-info, credential-schema, OAuth client
 * schema) all key off `useQuery({ enabled: !!url, ... })`, so handing back
 * empty strings is the canonical way to opt the call out — no request is
 * fired and `isAuthorized` stays `false`. See `use-get-api.spec.ts` and the
 * `useGetPluginCredentialInfo`/`useGetPluginCredentialSchema` hooks in
 * `web/service/use-plugins-auth.ts`.
 */
const EMPTY_API = {
  getCredentialInfo: '',
  setDefaultCredential: '',
  getCredentials: '',
  addCredential: '',
  updateCredential: '',
  deleteCredential: '',
  getCredentialSchema: () => '',
  getOauthUrl: '',
  getOauthClientSchema: '',
  setCustomOauthClient: '',
  getCustomOAuthClientValues: '',
  deleteCustomOAuthClient: '',
} as const

export const useGetApi = ({
  category = AuthCategory.tool,
  provider,
  providerType,
}: PluginPayload) => {
  // `category === tool` URLs always live under
  // `/workspaces/current/tool-provider/builtin/<provider>/...` and there is
  // no equivalent for custom (api) tool providers — they use the
  // provider-level credentials stored on the `tool_api_providers` row, not
  // the plugin credential model. Sending an api-type provider id (e.g. the
  // row id from `tool_api_providers`) to the builtin route makes the api
  // container ask the plugin daemon for a plugin that can never exist, and
  // the daemon raises `PluginNotFoundError` — surfacing as a 500 toast on
  // every /agents/<id>/configure page load (langgenius/dify#39169).
  //
  // Treat an explicitly-set non-builtin providerType as if no plugin auth
  // route applies, matching the established pattern for datasource/model
  // categories and for `web/app/components/workflow/nodes/tool/auth.ts`
  // (`isToolAuthorizationRequired`). We only gate when `providerType` is
  // explicitly provided (not undefined) so legacy call sites that pre-date
  // the `providerType` field keep working as before.
  if (
    category === AuthCategory.tool &&
    providerType !== undefined &&
    providerType !== CollectionType.builtIn
  )
    return EMPTY_API

  if (category === AuthCategory.tool) {
    return {
      getCredentialInfo: `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
      setDefaultCredential: `/workspaces/current/tool-provider/builtin/${provider}/default-credential`,
      getCredentials: `/workspaces/current/tool-provider/builtin/${provider}/credentials`,
      addCredential: `/workspaces/current/tool-provider/builtin/${provider}/add`,
      updateCredential: `/workspaces/current/tool-provider/builtin/${provider}/update`,
      deleteCredential: `/workspaces/current/tool-provider/builtin/${provider}/delete`,
      getCredentialSchema: (credential_type: CredentialTypeEnum) =>
        `/workspaces/current/tool-provider/builtin/${provider}/credential/schema/${credential_type}`,
      getOauthUrl: `/oauth/plugin/${provider}/tool/authorization-url`,
      getOauthClientSchema: `/workspaces/current/tool-provider/builtin/${provider}/oauth/client-schema`,
      setCustomOauthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      getCustomOAuthClientValues: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      deleteCustomOAuthClient: `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
    }
  }

  if (category === AuthCategory.datasource) {
    return {
      getCredentialInfo: '',
      setDefaultCredential: `/auth/plugin/datasource/${provider}/default`,
      getCredentials: `/auth/plugin/datasource/${provider}`,
      addCredential: `/auth/plugin/datasource/${provider}`,
      updateCredential: `/auth/plugin/datasource/${provider}/update`,
      deleteCredential: `/auth/plugin/datasource/${provider}/delete`,
      getCredentialSchema: () => '',
      getOauthUrl: `/oauth/plugin/${provider}/datasource/get-authorization-url`,
      getOauthClientSchema: '',
      setCustomOauthClient: `/auth/plugin/datasource/${provider}/custom-client`,
      deleteCustomOAuthClient: `/auth/plugin/datasource/${provider}/custom-client`,
    }
  }

  return EMPTY_API
}
