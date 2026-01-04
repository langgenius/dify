import {
  RiCloseLine,
  RiInformation2Fill,
} from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const PublishToast = () => {
  const { t } = useTranslation()
  const publishedAt = useStore(s => s.publishedAt)
  const [hideToast, setHideToast] = useState(false)

  if (publishedAt || hideToast)
    return null

  return (
    <div className="pointer-events-none absolute bottom-[45px] left-0 right-0 z-10 flex justify-center">
      <div
        className="relative flex w-[420px] space-x-1 overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent opacity-[0.4]">
        </div>
        <div className="flex h-6 w-6 items-center justify-center">
          <RiInformation2Fill className="text-text-accent" />
        </div>
        <div className="p-1">
          <div className="system-sm-semibold mb-1 text-text-primary">{t('publishToast.title', { ns: 'pipeline' })}</div>
          <div className="system-xs-regular text-text-secondary">
            {t('publishToast.desc', { ns: 'pipeline' })}
          </div>
        </div>
        <div
          className="pointer-events-auto flex h-6 w-6 cursor-pointer items-center justify-center"
          onClick={() => setHideToast(true)}
        >
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </div>
      </div>
    </div>
  )
}

export default memo(PublishToast)
