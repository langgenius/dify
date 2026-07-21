import type { HumanInputV2FormTransport } from './types'
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

export const realHumanInputV2FormTransport: HumanInputV2FormTransport = {
  getForm: unavailable,
  requestAccess: unavailable,
  submit: unavailable,
  requestUploadToken: unavailable,
  uploadLocalFile: unavailable,
  uploadRemoteFile: unavailable,
}
