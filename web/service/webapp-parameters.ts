import type { WebAppParametersResponse } from '@dify/contracts/api/web/types.gen'
import type { WebAppParameters } from '@/models/share'
import { selectAppParameters } from './console/app-parameters-select'

/** Adapt generated Web parameters for the existing Chat and Workflow configuration UI. */
export function selectWebAppParameters(parameters: WebAppParametersResponse): WebAppParameters {
  const config = selectAppParameters(parameters)
  // Preserve structured JSON defaults and optional file limits in public forms.
  const userInputForm = config.user_input_form.map((form, index) => {
    const source = parameters.user_input_form[index]
    if (!source) return form
    if ('file' in form && 'file' in source)
      return {
        file: {
          ...form.file,
          max_length: source.file.max_length ?? undefined,
        },
      }
    if ('file-list' in form && 'file-list' in source)
      return {
        'file-list': {
          ...form['file-list'],
          max_length: source['file-list'].max_length ?? undefined,
        },
      }
    if ('json_object' in form && 'json_object' in source)
      return { json_object: { ...form.json_object, default: source.json_object.default } }
    return form
  })
  return {
    ...config,
    user_input_form: userInputForm,
    account_login_enabled: parameters.account_login_enabled,
    account_login_url: parameters.account_login_url,
    allow_anonymous_end_user_auth: parameters.allow_anonymous_end_user_auth,
    connection_revision: parameters.connection_revision,
    requires_end_user_connections: parameters.requires_end_user_connections,
    connection_requirements: parameters.connection_requirements,
  }
}
