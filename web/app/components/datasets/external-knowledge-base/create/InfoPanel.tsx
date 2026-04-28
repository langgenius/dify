import { RiBookOpenLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

const InfoPanel = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className="flex w-[360px] flex-col items-start pt-[108px] pr-8 pb-2">
      <div className="flex w-full min-w-[240px] flex-col items-start gap-3 self-stretch rounded-xl bg-background-section p-6">
        <div className="flex h-10 w-10 grow items-center justify-center gap-2 self-stretch rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg p-1">
          <RiBookOpenLine className="h-5 w-5 text-text-accent" />
        </div>
        <p className="flex flex-col items-start gap-2 self-stretch">
          <span className="self-stretch system-xl-semibold text-text-secondary">
            {t('connectDatasetIntro.title', { ns: 'dataset' })}
          </span>
          <span className="system-sm-regular text-text-tertiary">
            {t('connectDatasetIntro.content.front', { ns: 'dataset' })}
            <a className="ml-1 system-sm-regular text-text-accent" href={docLink('/use-dify/knowledge/external-knowledge-api')} target="_blank" rel="noopener noreferrer">
              {t('connectDatasetIntro.content.link', { ns: 'dataset' })}
            </a>
            {t('connectDatasetIntro.content.end', { ns: 'dataset' })}
          </span>
          <a
            className="self-stretch system-sm-regular text-text-accent"
            href={docLink('/use-dify/knowledge/connect-external-knowledge-base')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('connectDatasetIntro.learnMore', { ns: 'dataset' })}
          </a>
        </p>
      </div>
    </div>
  )
}

export default InfoPanel
