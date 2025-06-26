import { useTranslation } from 'react-i18next'
import {
  RiExternalLinkLine,
  RiPuzzle2Line,
} from '@remixicon/react'
import { useDocLink } from '@/context/i18n'

const Empty = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className='mb-2 rounded-xl bg-background-section p-6'>
      <div className='mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-sm'>
        <RiPuzzle2Line className='h-5 w-5 text-text-accent' />
      </div>
      <div className='system-sm-medium mb-1 text-text-secondary'>{t('common.apiBasedExtension.title')}</div>
      <a
        className='system-xs-regular flex items-center text-text-accent'
        href={docLink('/guides/extension/api-based-extension/README')}
        target='_blank' rel='noopener noreferrer'
      >
        {t('common.apiBasedExtension.link')}
        <RiExternalLinkLine className='ml-1 h-3 w-3' />
      </a>
    </div>
  )
}

export default Empty
