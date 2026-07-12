import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

export function Empty() {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className="mb-2 flex flex-col items-start gap-3 rounded-xl bg-background-section p-6">
      <div className="flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-xs">
        <span
          aria-hidden
          className="i-custom-vender-workflow-api-aggregate size-5 text-text-tertiary"
        />
      </div>
      <div className="flex w-full flex-col gap-1">
        <div className="system-xs-regular text-text-primary">
          {t(($) => $['apiBasedExtension.title'], { ns: 'common' })}
        </div>
        <a
          className="flex items-center gap-1 system-xs-regular text-text-accent"
          href={docLink('/use-dify/workspace/api-extension/api-extension')}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(($) => $['apiBasedExtension.link'], { ns: 'common' })}
          <span aria-hidden className="i-ri-external-link-line size-3" />
        </a>
      </div>
    </div>
  )
}
