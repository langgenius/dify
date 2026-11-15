import type { ComponentProps } from 'react'
import { DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'

const ExternalApiEditor = lazy(() => import('./index'))

export function ExternalApiDialogContent(props: ComponentProps<typeof ExternalApiEditor>) {
  return (
    <Suspense fallback={null}>
      <DialogContent>
        <ExternalApiEditor {...props} />
      </DialogContent>
    </Suspense>
  )
}
