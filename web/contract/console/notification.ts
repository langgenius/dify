import { type } from '@orpc/contract'
import { base } from '../base'

type ConsoleNotification = {
  body: string
  frequency: 'once' | 'always'
  lang: string
  notification_id: string
  subtitle: string
  title: string
  title_pic_url?: string
}

type ConsoleNotificationResponse = {
  notifications: ConsoleNotification[]
  should_show: boolean
}

export const notificationContract = base
  .route({
    path: '/notification',
    method: 'GET',
  })
  .output(type<ConsoleNotificationResponse>())

export const notificationDismissContract = base
  .route({
    path: '/notification/dismiss',
    method: 'POST',
  })
  .input(type<{
    body: {
      notification_id: string
    }
  }>())
  .output(type<unknown>())
