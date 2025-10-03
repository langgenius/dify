import { get, post } from './base'

export const getMFAStatus = () => {
  return get<{
    enabled: boolean
    setup_at: string | null
  }>('/console/api/account/mfa/status')
}

export const setupMFA = () => {
  return post<{
    secret: string
    qr_code: string
  }>('/console/api/account/mfa/setup')
}

export const verifyMFA = (data: { token: string; password: string }) => {
  return post<{
    backup_codes: string[]
  }>('/console/api/account/mfa/verify', {
    body: data,
  })
}

export const disableMFA = (data: { password: string }) => {
  return post('/console/api/account/mfa/disable', {
    body: data,
  })
}
