import { type } from '@orpc/contract'
import { base } from '../base'

export type AccountProfileResponse = {
  id: string
  name: string
  email: string
  avatar: string
  avatar_url: string | null
  is_password_set: boolean
  interface_language?: string
  interface_theme?: string
  timezone?: string
  last_login_at?: string
  last_active_at?: string
  last_login_ip?: string
  created_at?: string
}

export const accountProfileContract = base
  .route({
    path: '/account/profile',
    method: 'GET',
  })
  .output(type<AccountProfileResponse>())

export const accountAvatarContract = base
  .route({
    path: '/account/avatar',
    method: 'GET',
  })
  .input(type<{
    query: {
      avatar: string
    }
  }>())
  .output(type<{ avatar_url: string }>())
