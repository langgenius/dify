import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { consoleQuery } from '@/service/console'

export const useOAuthClient = (pluginPayload: PluginPayload, enabled: boolean) => {
  const { t } = useTranslation(['plugin'])
  const renderI18nObject = useRenderI18nObject()
  const query = useQuery(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.queryOptions(
      {
        input: enabled ? { params: { provider: pluginPayload.provider } } : skipToken,
        staleTime: 0,
      },
    ),
  )
  const client = query.data
  const params = client?.client_params ?? {}
  const schemas: FormSchema[] = (client?.schema ?? []).map((field) => ({
    ...field,
    label: field.label ? renderI18nObject(field.label) : field.name,
    required: !!field.required,
    default: params[field.name] ?? field.default,
    help: field.help ? renderI18nObject(field.help) : undefined,
    placeholder: field.placeholder ? renderI18nObject(field.placeholder) : undefined,
    scope: field.scope ?? undefined,
    url: field.url ?? undefined,
    options: field.options?.map((option) => ({ ...option, label: renderI18nObject(option.label) })),
    show_on: client?.is_system_oauth_params_exists
      ? [{ variable: '__oauth_client__', value: 'custom' }]
      : undefined,
  }))
  if (client?.is_system_oauth_params_exists) {
    schemas.unshift({
      name: '__oauth_client__',
      type: FormTypeEnum.radio,
      label: t(($) => $['auth.oauthClient'], { ns: 'plugin' }),
      required: false,
      options: [
        { label: t(($) => $['auth.default'], { ns: 'plugin' }), value: 'default' },
        { label: t(($) => $['auth.custom'], { ns: 'plugin' }), value: 'custom' },
      ],
    })
  }
  const clientType = client?.is_oauth_custom_client_enabled
    ? ('custom' as const)
    : client?.is_system_oauth_params_exists
      ? ('default' as const)
      : undefined

  return {
    query,
    schemas,
    clientType,
    redirectUri: client?.redirect_uri,
    editValues: { ...params, __oauth_client__: clientType ?? 'custom' },
    hasOriginalClientParams: Object.keys(params).length > 0,
  }
}
