import type { ComponentProps } from 'react'
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const ExternalApiEditor = lazy(() => import('./index'))

export function ExternalApiDialogContent(props: ComponentProps<typeof ExternalApiEditor>) {
  const { t } = useTranslation(['common'])
  return (
    <DialogContent>
      <Suspense
        fallback={
          <>
            <DialogHeader>
              <DialogTitle>{t(($) => $.loading)}</DialogTitle>
              <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'])} />
            </DialogHeader>
            <DialogBody>
              <LoadingPlaceholder />
            </DialogBody>
          </>
        }
      >
        <ExternalApiEditor key={props.api?.id} {...props} />
      </Suspense>
    </DialogContent>
  )
}
