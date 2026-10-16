'use client'

import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
      <DialogContent className="flex w-160 flex-col overflow-hidden p-0">
        <div className="shrink-0 space-y-1 pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['connections.configure.title'], { ns: 'share' })}
          </DialogTitle>
          {isResponding && (
            <DialogDescription className="system-xs-regular text-text-tertiary">
              {t(($) => $['connections.configure.runningDescription'], { ns: 'share' })}
            </DialogDescription>
          )}
        </div>
        <DialogClose
          render={
            <IconButton
              size="md"
              className="absolute top-5 right-5"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            >
              <span className="i-ri-close-line size-4.5" aria-hidden="true" />
            </IconButton>
          }
        />
        <div className="min-h-0 overflow-y-auto overscroll-contain px-7 py-6">
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
      </DialogContent>
    </Dialog>
  )
}
