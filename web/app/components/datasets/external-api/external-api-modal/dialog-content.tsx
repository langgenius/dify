import type { ComponentProps } from 'react'
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Infotip, InfotipContent, InfotipTitle, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const ExternalApiEditor = lazy(() => import('./index'))

export function ExternalApiDialogContent(props: ComponentProps<typeof ExternalApiEditor>) {
  const { api, pending } = props
  const datasetBindings = api?.dataset_bindings ?? []
  const { t } = useTranslation(['common', 'dataset'])
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {api
            ? t(($) => $.editExternalAPIFormTitle, { ns: 'dataset' })
            : t(($) => $.createExternalAPI, { ns: 'dataset' })}
        </DialogTitle>
        {datasetBindings.length > 0 && (
          <div className="flex items-center system-xs-regular text-text-tertiary">
            {t(($) => $['editExternalAPIFormWarning.front'], { ns: 'dataset' })}
            <span className="flex cursor-pointer items-center text-text-accent">
              &nbsp;
              {datasetBindings.length}{' '}
              {t(($) => $['editExternalAPIFormWarning.end'], { ns: 'dataset' })}
              &nbsp;
              <Infotip>
                <InfotipTrigger
                  iconVariant="information"
                  aria-label={t(($) => $.editExternalAPITooltipTitle, { ns: 'dataset' })}
                />
                <InfotipContent className="w-80">
                  <InfotipTitle className="system-xs-medium-uppercase">
                    {datasetBindings.length}{' '}
                    {t(($) => $.editExternalAPITooltipTitle, { ns: 'dataset' })}
                  </InfotipTitle>
                  <ul>
                    {datasetBindings.map((binding) => (
                      <li key={binding.id} className="flex items-center gap-1 py-1">
                        <span aria-hidden className="i-ri-book-2-line size-4" />
                        {binding.name}
                      </li>
                    ))}
                  </ul>
                </InfotipContent>
              </Infotip>
            </span>
          </div>
        )}
        <DialogHeaderCloseButton
          disabled={pending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <Suspense
        fallback={
          <DialogBody>
            <LoadingPlaceholder />
          </DialogBody>
        }
      >
        <ExternalApiEditor key={props.api?.id} {...props} />
      </Suspense>
    </DialogContent>
  )
}
