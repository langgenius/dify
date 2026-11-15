import type { ComponentProps } from 'react'
import {
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiBook2Line, RiInformation2Line } from '@remixicon/react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const ExternalApiEditor = lazy(() => import('./index'))

export function ExternalApiDialogContent(props: ComponentProps<typeof ExternalApiEditor>) {
  const { api, pending } = props
  const datasetBindings = api?.dataset_bindings
  const { t } = useTranslation(['common', 'dataset'])
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {api
            ? t(($) => $.editExternalAPIFormTitle, { ns: 'dataset' })
            : t(($) => $.createExternalAPI, { ns: 'dataset' })}
        </DialogTitle>
        {api && (datasetBindings?.length ?? 0) > 0 && (
          <div className="flex items-center system-xs-regular text-text-tertiary">
            {t(($) => $['editExternalAPIFormWarning.front'], { ns: 'dataset' })}
            <span className="flex cursor-pointer items-center text-text-accent">
              &nbsp;
              {datasetBindings?.length}{' '}
              {t(($) => $['editExternalAPIFormWarning.end'], { ns: 'dataset' })}
              &nbsp;
              <Popover>
                <PopoverTrigger
                  openOnHover
                  aria-label={t(($) => $['editExternalAPIFormWarning.end'], { ns: 'dataset' })}
                  render={
                    <button
                      type="button"
                      className="flex size-3.5 items-center justify-center rounded-sm hover:bg-state-base-hover"
                    >
                      <RiInformation2Line className="size-3.5" />
                    </button>
                  }
                />
                <PopoverContent className="flex w-[320px] items-center self-stretch px-3 py-2">
                  <div className="p-1">
                    <div className="flex items-start self-stretch ps-2 pe-3 pt-1 pb-0.5">
                      <div className="system-xs-medium-uppercase text-text-tertiary">{`${datasetBindings?.length} ${t(($) => $.editExternalAPITooltipTitle, { ns: 'dataset' })}`}</div>
                    </div>
                    {datasetBindings?.map((binding) => (
                      <div
                        key={binding.id}
                        className="flex items-center gap-1 self-stretch px-2 py-1"
                      >
                        <RiBook2Line className="size-4 text-text-secondary" />
                        <div className="system-sm-medium text-text-secondary">{binding.name}</div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
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
