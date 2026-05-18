'use client'

import type { InSiteMessageActionItem } from './index'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IS_CLOUD_EDITION } from '@/config'
import { consoleQuery } from '@/service/client'
import InSiteMessage from './index'

type NotificationBodyPayload = {
  actions: InSiteMessageActionItem[]
  main: string
}

function isValidActionItem(value: unknown): value is InSiteMessageActionItem {
  if (!value || typeof value !== 'object')
    return false

  const candidate = value as {
    action?: unknown
    data?: unknown
    text?: unknown
    type?: unknown
  }

  return (
    typeof candidate.text === 'string'
    && (candidate.type === 'primary' || candidate.type === 'default')
    && (candidate.action === 'link' || candidate.action === 'close')
    && (candidate.data === undefined || typeof candidate.data !== 'function')
  )
}

function parseNotificationBody(body: string): NotificationBodyPayload | null {
  try {
    const parsed = JSON.parse(body) as {
      actions?: unknown
      main?: unknown
    }

    if (!parsed || typeof parsed !== 'object')
      return null

    if (typeof parsed.main !== 'string')
      return null

    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.filter(isValidActionItem)
      : []

    return {
      main: parsed.main,
      actions,
    }
  }
  catch {
    return null
  }
}

function InSiteMessageNotification() {
  const { t } = useTranslation()
  const dismissNotificationMutation = useMutation(consoleQuery.notificationDismiss.mutationOptions())

  const { data } = useQuery(consoleQuery.notification.queryOptions({
    enabled: IS_CLOUD_EDITION,
  }))

  const notification = data?.notifications?.[0]
  const parsedBody = notification ? parseNotificationBody(notification.body) : null

  if (!IS_CLOUD_EDITION || !notification)
    return null

  const fallbackActions: InSiteMessageActionItem[] = [
    {
      type: 'default',
      action_name: 'dismiss',
      text: t('operation.close', { ns: 'common' }),
      action: 'close',
    },
  ]

  const actions = parsedBody?.actions?.length ? parsedBody.actions : fallbackActions
  const main = parsedBody?.main ?? notification.body
  const handleAction = (action: InSiteMessageActionItem) => {
    if (action.action !== 'close')
      return

    dismissNotificationMutation.mutate({
      body: {
        notification_id: notification.notification_id,
      },
    })
  }

  return (
    <InSiteMessage
      key={notification.notification_id}
      notificationId={notification.notification_id}
      title={notification.title}
      subtitle={notification.subtitle}
      headerBgUrl={notification.title_pic_url}
      main={main}
      actions={actions}
      onAction={handleAction}
    />
  )
}

export default InSiteMessageNotification
