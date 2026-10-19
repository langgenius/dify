'use client'

import type { EndUserConnection, LinkedApp } from '../model'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

type Props = {
  connection: EndUserConnection
  connectionLabelId: string
}

function LinkedAppItem({ app }: { app: LinkedApp }) {
  const nameId = useId()
  const descriptionId = useId()

  return (
    <li className="h-16 border-b border-divider-subtle">
      <Link
        href={app.href}
        aria-labelledby={nameId}
        aria-describedby={descriptionId}
        className="-ml-2 flex h-full items-center gap-3 rounded-md py-3 pl-2 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
      >
        <AppIcon
          size="small"
          icon={{ icon_type: 'emoji', icon: app.icon, icon_background: app.iconBackground }}
          decorative
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span id={nameId} className="truncate system-md-semibold text-text-secondary">
            {app.name}
          </span>
          <span id={descriptionId} className="truncate system-xs-regular text-text-tertiary">
            {app.description}
          </span>
        </div>
        <span
          className="flex size-6 shrink-0 items-center justify-center text-text-tertiary"
          aria-hidden="true"
        >
          <span className="i-ri-arrow-right-up-line size-4" />
        </span>
      </Link>
    </li>
  )
}

export default function LinkedAppsDialog({ connection, connectionLabelId }: Props) {
  const { t } = useTranslation(['app', 'common'])

  return (
    <Dialog>
      <DialogTrigger
        aria-describedby={connectionLabelId}
        className="inline-flex min-h-6 items-center rounded-md system-xs-medium text-text-accent hover:underline"
      >
        {t(($) => $['endUser.linkedAppCount'], { ns: 'app', count: connection.apps.length })}
      </DialogTrigger>
      <DialogContent className="w-130">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['endUser.linkedAppsTitle'], { ns: 'app', count: connection.apps.length })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="max-h-94">
          {connection.apps.length > 0 ? (
            <ul className="-ml-2 pl-2">
              {connection.apps.map((app) => (
                <LinkedAppItem key={app.id} app={app} />
              ))}
            </ul>
          ) : (
            <p className="system-sm-regular text-text-tertiary">
              {t(($) => $['endUser.noLinkedApps'], { ns: 'app' })}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
