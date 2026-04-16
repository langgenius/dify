import { type } from '@orpc/contract'
import { base } from '../base'

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
