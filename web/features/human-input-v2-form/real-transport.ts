import type { HumanInputV2FormTransport } from './types'
import { zHumanInputV2FormSubmitRequest } from '@dify/contracts/api/web/zod.gen'
import { normalizeHumanInputFormInput } from '@/app/components/workflow/nodes/human-input/shared/types'
import { humanInputV2FormClient } from '@/service/human-input-v2'

export const getHumanInputV2Paths = (token: string) => {
  const encodedToken = encodeURIComponent(token)
  const formPath = `/form/human-input/v2/public/${encodedToken}`

  return {
    form: formPath,
    accessRequest: `${formPath}/access-request`,
    uploadToken: `${formPath}/upload-token`,
  }
}

export const realHumanInputV2FormTransport: HumanInputV2FormTransport = {
  async getForm(token, options) {
    const response = await humanInputV2FormClient.getForm(
      { params: { form_token: token } },
      options,
    )
    return {
      formContent: response.form_content ?? '',
      inputs: (response.inputs ?? []).map(normalizeHumanInputFormInput),
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
  async uploadLocalFile(token, file, options) {
    const grant = await this.requestUploadToken(token, options)
    const uploaded = await humanInputV2FormClient.uploadFile(
      {
        headers: { Authorization: `Bearer ${grant.uploadToken}` },
        body: { file },
      },
      options,
    )
    return {
      id: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mime_type ?? 'application/octet-stream',
      size: uploaded.size,
      url: uploaded.url ?? '',
    }
  },
  async uploadRemoteFile(token, url, options) {
    const grant = await this.requestUploadToken(token, options)
    const uploaded = await humanInputV2FormClient.uploadRemoteFile(
      {
        headers: { Authorization: `Bearer ${grant.uploadToken}` },
        body: { url },
      },
      options,
    )
    return {
      id: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mime_type ?? 'application/octet-stream',
      size: uploaded.size,
      url: uploaded.url ?? '',
    }
  },
}
