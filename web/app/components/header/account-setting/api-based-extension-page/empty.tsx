import {
  RiExternalLinkLine,
  RiPuzzle2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

export function Empty() {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className="mb-2 rounded-xl bg-background-section p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-xs">
        <RiPuzzle2Line className="size-5 text-text-accent" />
      </div>
      <div className="mb-1 system-sm-medium text-text-secondary">{t('apiBasedExtension.title', { ns: 'common' })}</div>
      <a
        className="flex items-center system-xs-regular text-text-accent"
        href={docLink('/use-dify/workspace/api-extension/api-extension')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('apiBasedExtension.link', { ns: 'common' })}
        <RiExternalLinkLine className="ml-1 size-3" />
      </a>
    </div>
  )
}
