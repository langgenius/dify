import { RiBookOpenLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const InfoPanel = () => {
  const { t } = useTranslation()

  return (
    <div className='flex w-[360px] flex-col items-start pb-2 pr-8 pt-[108px]'>
      <div className='bg-background-section flex w-full min-w-[240px] flex-col items-start gap-3 self-stretch rounded-xl p-6'>
        <div className='border-components-card-border bg-components-card-bg flex h-10 w-10 grow items-center justify-center gap-2 self-stretch rounded-lg border-[0.5px] p-1'>
          <RiBookOpenLine className='text-text-accent h-5 w-5' />
        </div>
        <p className='flex flex-col items-start gap-2 self-stretch'>
          <span className='text-text-secondary system-xl-semibold self-stretch'>
            {t('dataset.connectDatasetIntro.title')}
          </span>
          <span className='text-text-tertiary system-sm-regular'>
            {t('dataset.connectDatasetIntro.content.front')}
            <a className='text-text-accent system-sm-regular ml-1' href='https://docs.dify.ai/guides/knowledge-base/external-knowledge-api-documentation' target='_blank' rel="noopener noreferrer">
              {t('dataset.connectDatasetIntro.content.link')}
            </a>
            {t('dataset.connectDatasetIntro.content.end')}
          </span>
          <a className='text-text-accent system-sm-regular self-stretch' href='https://docs.dify.ai/guides/knowledge-base/connect-external-knowledge' target='_blank' rel="noopener noreferrer">
            {t('dataset.connectDatasetIntro.learnMore')}
          </a>
        </p>
      </div>
    </div>
  )
}

export default InfoPanel
