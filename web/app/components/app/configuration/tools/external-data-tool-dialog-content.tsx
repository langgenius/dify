import type { ComponentProps } from 'react'
import { DialogBody, DialogContent, DialogHeader, DialogTitle } from '@langgenius/dify-ui/dialog'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const ExternalDataToolForm = lazy(() => import('./external-data-tool-modal'))

export function ExternalDataToolDialogContent(props: ComponentProps<typeof ExternalDataToolForm>) {
  const { t } = useTranslation(['appDebug', 'common'])
  const action = props.data?.type
    ? t(($) => $['operation.edit'], { ns: 'common' })
    : t(($) => $['operation.add'], { ns: 'common' })
  return (
    <DialogContent className="w-160">
      <DialogHeader>
        <DialogTitle>{`${action} ${t(($) => $['variableConfig.apiBasedVar'], { ns: 'appDebug' })}`}</DialogTitle>
      </DialogHeader>
      <Suspense
        fallback={
          <DialogBody>
            <LoadingPlaceholder />
          </DialogBody>
        }
      >
        <ExternalDataToolForm {...props} />
      </Suspense>
    </DialogContent>
  )
}
