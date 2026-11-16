'use client'

import type { DialogActions, DialogHandle } from '@langgenius/dify-ui/dialog'
import type { UpdatePluginPayload } from '../../types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PluginCategoryEnum } from '../../types'
import createFoldAnimInto from '../hooks/create-fold-anim-into'

const Installer = lazy(() => import('./index'))

export function GitHubInstallDialog({
  handle,
  children,
  installContextCategory,
  onUpdated,
}: {
  handle?: DialogHandle<UpdatePluginPayload>
  children?: React.ReactNode
  installContextCategory?: PluginCategoryEnum
  onUpdated?: () => void | Promise<void>
}) {
  const actionsRef = useRef<DialogActions>(null)
  const [session, setSession] = useState<ReturnType<typeof createFoldAnimInto>>()
  useEffect(() => session?.dispose, [session])
  return (
    <Dialog
      handle={handle}
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (open) {
          setSession(createFoldAnimInto(() => actionsRef.current?.close()))
        } else if (details.reason === 'imperative-action') {
          session?.dispose()
        } else if (session) {
          details.cancel()
          session.requestClose()
        }
      }}
    >
      {({ payload }) => (
        <>
          {children}
          {session && (
            <GitHubInstallContent popupRef={session.popupRef}>
              <Installer
                updatePayload={payload?.github}
                installContextCategory={installContextCategory}
                onStartInstalling={session.startInstalling}
                onFinishInstalling={() => session.setIsInstalling(false)}
                onClose={session.close}
                onSuccess={
                  payload &&
                  (async () => {
                    if (payload.category === PluginCategoryEnum.model) {
                      await onUpdated?.()
                      session.close()
                    } else {
                      session.close()
                      await onUpdated?.()
                    }
                  })
                }
              />
            </GitHubInstallContent>
          )}
        </>
      )}
    </Dialog>
  )
}

export function GitHubInstallContent({
  children,
  popupRef,
}: {
  children: React.ReactNode
  popupRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <Suspense fallback={null}>
      <DialogContent
        ref={popupRef}
        className="max-h-[calc(100dvh-3rem)] w-140"
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
