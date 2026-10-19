'use client'

import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import RequiredServices from './required-services'

type Props = Omit<ComponentProps<typeof RequiredServices>, 'disabled'> & {
  isResponding?: boolean
}

export default function ConfigureConnections({
  services,
  onConnect,
  onConnectionChange,
  onReconnect,
  onReplace,
  onRemove,
  isResponding = false,
  className,
}: Props) {
  const { t } = useTranslation(['share', 'common'])

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" className={className} />}>
        <span className="i-ri-link size-4" aria-hidden="true" />
        {t(($) => $['connections.configure.title'], { ns: 'share' })}
      </DialogTrigger>
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle>{t(($) => $['connections.configure.title'], { ns: 'share' })}</DialogTitle>
          {isResponding && (
            <DialogDescription>
              {t(($) => $['connections.configure.runningDescription'], { ns: 'share' })}
            </DialogDescription>
          )}
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <div className="px-1 py-3">
            <RequiredServices
              services={services}
              onConnect={onConnect}
              onConnectionChange={onConnectionChange}
              disabled={isResponding}
              onReconnect={onReconnect}
              onReplace={onReplace}
              onRemove={onRemove}
            />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
