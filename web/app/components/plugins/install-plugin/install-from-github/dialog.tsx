'use client'

import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { UpdatePluginPayload } from '../../types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense, useRef } from 'react'
import { PluginCategoryEnum } from '../../types'
import useHideLogic from '../hooks/use-hide-logic'

const Installer = lazy(() => import('./index'))

export function GitHubInstallDialog({
  handle,
  installContextCategory,
  onUpdated,
}: {
  handle: DialogHandle<UpdatePluginPayload>
  installContextCategory?: PluginCategoryEnum
  onUpdated?: () => void | Promise<void>
}) {
  const { modalClassName, foldAnimInto, setIsInstalling, handleStartToInstall } = useHideLogic(() =>
    handle.close(),
  )
  return (
    <Dialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (!open && details.reason !== 'imperative-action') {
          details.cancel()
          foldAnimInto()
        }
        if (!open && details.reason === 'imperative-action') setIsInstalling(false)
      }}
    >
      {({ payload }) => (
        <GitHubInstallContent className={modalClassName}>
          <Installer
            updatePayload={payload?.github}
            installContextCategory={installContextCategory}
            onStartInstalling={handleStartToInstall}
            onFinishInstalling={() => setIsInstalling(false)}
            onClose={() => handle.close()}
            onSuccess={
              payload &&
              (async () => {
                if (payload.category === PluginCategoryEnum.model) {
                  await onUpdated?.()
                  handle.close()
                } else {
                  handle.close()
                  await onUpdated?.()
                }
              })
            }
          />
        </GitHubInstallContent>
      )}
    </Dialog>
  )
}

export function GitHubInstallContent({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Suspense fallback={null}>
      <DialogContent
        ref={popupRef}
        className={`max-h-[calc(100dvh-3rem)] w-140 ${className}`}
        backdropProps={{ forceRender: true }}
        initialFocus={(interaction) =>
          interaction === 'touch'
            ? popupRef.current
            : (popupRef.current?.querySelector<HTMLInputElement>('input[name="repoUrl"]') ?? true)
        }
      >
        {children}
      </DialogContent>
    </Suspense>
  )
}
