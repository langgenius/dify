import type { ComponentProps } from 'react'
import { DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'

const ExternalDataToolForm = lazy(() => import('./external-data-tool-modal'))

export function ExternalDataToolDialogContent(props: ComponentProps<typeof ExternalDataToolForm>) {
  return (
    <Suspense fallback={null}>
      <DialogContent className="w-160">
        <ExternalDataToolForm {...props} />
      </DialogContent>
    </Suspense>
  )
}
