'use client'

import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { consoleQuery } from '@/service/console'
import { systemModelDialog } from './handle'

const SystemModelSession = lazy(() => import('./session'))

const saveFilter = {
  mutationKey: consoleQuery.workspaces.current.defaultModel.post.mutationKey(),
  exact: true,
}

export function SystemModelDialog() {
  const queryClient = useQueryClient()

  return (
    <Dialog
      handle={systemModelDialog}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && details.reason !== 'imperative-action' && queryClient.isMutating(saveFilter))
          details.cancel()
      }}
    >
      <Suspense fallback={null}>
        <DialogContent>
          <SystemModelSession />
        </DialogContent>
      </Suspense>
    </Dialog>
  )
}
