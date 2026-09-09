import type { FormInputConfig } from '@dify/contracts/api/web/types.gen'
import type { HumanInputV2FormTransport } from './types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { zHumanInputV2FormSubmitRequest } from '@dify/contracts/api/web/zod.gen'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { humanInputV2FormClient } from '@/service/client'
import { createHumanInputV2Error } from './errors'

export const getHumanInputV2Paths = (token: string) => {
  const encodedToken = encodeURIComponent(token)
  const formPath = `/form/human-input/${encodedToken}`

  return {
    form: formPath,
    accessRequest: `${formPath}/access-request`,
    uploadToken: `${formPath}/upload-token`,
  }
}

const unavailable = async (): Promise<never> => {
  throw createHumanInputV2Error('unavailable', 'human_input_v2_unavailable', 501)
}

const toFormInput = (input: FormInputConfig): FormInputItem => {
  if (input.type === 'paragraph') {
    return {
      type: InputVarType.paragraph,
      output_variable_name: input.output_variable_name,
      default: {
        type: input.default?.type ?? 'constant',
        value: input.default?.value ?? '',
        selector: input.default?.selector ?? [],
      },
    }
  }
  if (input.type === 'select') {
    return {
      type: InputVarType.select,
      output_variable_name: input.output_variable_name,
      option_source: {
        type: input.option_source.type,
        value: input.option_source.value ?? [],
        selector: input.option_source.selector ?? [],
      },
    }
  }
  const fileSettings = {
    output_variable_name: input.output_variable_name,
    allowed_file_types: (input.allowed_file_types ?? []).map(
      (type) => SupportUploadFileTypes[type],
    ),
    allowed_file_extensions: input.allowed_file_extensions ?? [],
    allowed_file_upload_methods: (input.allowed_file_upload_methods ?? []).filter(
      (method) => method === 'local_file' || method === 'remote_url',
    ),
  }
  return input.type === 'file-list'
    ? { ...fileSettings, type: InputVarType.multiFiles, number_limits: input.number_limits }
    : { ...fileSettings, type: InputVarType.singleFile }
}

export const realHumanInputV2FormTransport: HumanInputV2FormTransport = {
  async getForm(token, options) {
    const response = await humanInputV2FormClient.getForm(
      { params: { form_token: token } },
      options,
    )
    return {
      formContent: response.form_content ?? '',
      inputs: (response.inputs ?? []).map(toFormInput),
      resolvedDefaultValues: response.resolved_default_values ?? {},
      actions: (response.user_actions ?? []).map((action) => ({
        ...action,
        button_style: action.button_style ?? 'default',
      })),
      expirationTime: response.expiration_time,
    }
  },
  async requestAccess(token, options) {
    const response = await humanInputV2FormClient.requestAccess(
      { params: { form_token: token } },
      options,
    )
    return {
      challengeToken: response.challenge_token,
      expiresInSeconds: response.expires_in_seconds,
      resendAfterSeconds: response.resend_after_seconds,
    }
  },
  async submit(token, payload, options) {
    await humanInputV2FormClient.submit(
      {
        params: { form_token: token },
        body: zHumanInputV2FormSubmitRequest.parse(payload),
      },
      options,
    )
  },
  async requestUploadToken(token, options) {
    const response = await humanInputV2FormClient.requestUploadToken(
      { params: { form_token: token } },
      options,
    )
    return { uploadToken: response.upload_token, expiresAt: response.expires_at * 1000 }
  },
  // The current upload endpoint validates legacy form tokens only. Keep v2 files
  // unavailable until a v2 upload contract exists; never send v2 proof to v1.
  uploadLocalFile: unavailable,
  uploadRemoteFile: unavailable,
}
