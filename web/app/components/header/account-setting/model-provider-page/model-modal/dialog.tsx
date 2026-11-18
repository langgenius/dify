'use client'

import type { ComponentRef } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense, useRef, useState } from 'react'
import { modelCredentialDialog } from './handle'

const CredentialForm = lazy(() => import('./index'))

export function ModelCredentialDialog() {
  const form = useRef<ComponentRef<typeof CredentialForm>>(null)
  const latestSession = useRef(0)
  const [session, setSession] = useState(0)
  return (
    <Dialog
      handle={modelCredentialDialog}
      onOpenChange={(open, details) => {
        if (!open && form.current?.isPending() && details.reason !== 'imperative-action') {
          details.cancel()
          return
        }
        latestSession.current += 1
        if (open) setSession(latestSession.current)
      }}
    >
      {({ payload }) => (
        <Suspense fallback={null}>
          <DialogContent backdropProps={{ forceRender: true }} className="w-160">
            {payload && (
              <CredentialForm
                key={session}
                ref={form}
                {...payload}
                onSuccess={(values) => {
                  if (form.current && session === latestSession.current)
                    modelCredentialDialog.close()
                  if (values) payload.onSave?.(payload.credential, values)
                }}
              />
            )}
          </DialogContent>
        </Suspense>
      )}
    </Dialog>
  )
}
