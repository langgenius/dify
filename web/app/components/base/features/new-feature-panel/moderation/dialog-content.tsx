import type { ComponentProps } from 'react'
import { DialogContent } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'

const ModerationForm = lazy(() => import('./moderation-setting-modal'))

export function ModerationDialogContent(props: ComponentProps<typeof ModerationForm>) {
  return (
    <Suspense fallback={null}>
      <DialogContent className="w-150">
        <ModerationForm {...props} />
      </DialogContent>
    </Suspense>
  )
}
