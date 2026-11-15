'use client'

import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'
import { modelCredentialDialog } from './handle'

const CredentialForm = lazy(() => import('./index'))

export function ModelCredentialDialog() {
  return (
    <Dialog handle={modelCredentialDialog}>
      {({ payload }) => (
        <Suspense fallback={null}>
          <DialogContent backdropProps={{ forceRender: true }} className="w-160">
            {payload && (
              <CredentialForm
                {...payload}
                onCancel={() => modelCredentialDialog.close()}
                onSave={(values) => {
                  payload.onSave?.(payload.credential, values)
                  modelCredentialDialog.close()
                }}
              />
            )}
          </DialogContent>
        </Suspense>
      )}
    </Dialog>
  )
}
