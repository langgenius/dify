import { useTranslation } from 'react-i18next'
import {
  RiExternalLinkLine,
  RiPuzzle2Line,
} from '@remixicon/react'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='mb-2 p-6 rounded-xl bg-background-section'>
      <div className='flex items-center justify-center mb-3 w-10 h-10 rounded-[10px] bg-components-card-bg-alt backdrop-blur-sm border-[0.5px] border-components-card-border shadow-lg'>
        <RiPuzzle2Line className='w-5 h-5 text-text-accent' />
      </div>
      <div className='mb-1 text-text-secondary system-sm-medium'>{t('common.apiBasedExtension.title')}</div>
      <a
        className='flex items-center system-xs-regular text-text-accent'
        href={t('common.apiBasedExtension.linkUrl') || '/'}
        target='_blank' rel='noopener noreferrer'
      >
        {t('common.apiBasedExtension.link')}
        <RiExternalLinkLine className='ml-1 w-3 h-3' />
      </a>
    </div>
  )
}

export default Empty
