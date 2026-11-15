'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense, useRef, useState } from 'react'
import { modelCredentialDialog } from './handle'

const CredentialForm = lazy(() => import('./index'))

export function ModelCredentialDialog() {
  const actionsRef = useRef<DialogActions>(null)
  const pendingRequestRef = useRef<Promise<void> | null>(null)
  const [session, setSession] = useState(0)
  return (
    <Dialog
      handle={modelCredentialDialog}
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (!open && pendingRequestRef.current && details.reason !== 'imperative-action') {
          details.cancel()
          return
        }
        pendingRequestRef.current = null
        if (open) setSession((current) => current + 1)
      }}
    >
      {({ payload }) => (
        <Suspense fallback={null}>
          <DialogContent backdropProps={{ forceRender: true }} className="w-160">
            {payload && (
              <CredentialForm
                key={session}
                {...payload}
                onSubmit={async (perform, values) => {
                  if (pendingRequestRef.current) return
                  const request = perform()
                  pendingRequestRef.current = request
                  try {
                    await request
                  } catch {
                    // The console client reports request errors. Keep the draft available for retry.
                    if (pendingRequestRef.current === request) pendingRequestRef.current = null
                    return
                  }
                  if (pendingRequestRef.current === request) {
                    pendingRequestRef.current = null
                    actionsRef.current?.close()
                  }
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
