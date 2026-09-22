import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiCloseLine, RiInformation2Fill } from '@remixicon/react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const PublishToast = () => {
  const { t } = useTranslation()
  const publishedAt = useStore((s) => s.publishedAt)
  const [hideToast, setHideToast] = useState(false)

  if (publishedAt || hideToast) return null

  return (
    <div className="pointer-events-none absolute right-0 bottom-11.25 left-0 z-10 flex justify-center">
      <div className="relative flex w-105 space-x-1 overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent opacity-[0.4]"></div>
        <div className="flex size-6 items-center justify-center">
          <RiInformation2Fill className="text-text-accent" />
        </div>
        <div className="p-1">
          <div className="mb-1 system-sm-semibold text-text-primary">
            {t(($) => $['publishToast.title'], { ns: 'pipeline' })}
          </div>
          <div className="system-xs-regular text-text-secondary">
            {t(($) => $['publishToast.desc'], { ns: 'pipeline' })}
          </div>
        </div>
        <IconButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="nokey pointer-events-auto shrink-0"
          onClick={() => setHideToast(true)}
        >
          <RiCloseLine aria-hidden="true" className="size-4 text-text-tertiary" />
        </IconButton>
      </div>
    </div>
  )
}

export default memo(PublishToast)
