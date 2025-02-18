import { useTranslation } from 'react-i18next'
import { Webhooks } from '@/app/components/base/icons/src/vender/line/development'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='mb-2 rounded-2xl bg-gray-50 p-6'>
      <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-[10px] border border-[#EAECF5]'>
        <Webhooks className='h-6 w-6 text-gray-500' />
      </div>
      <div className='mb-2 text-sm text-gray-600'>{t('common.apiBasedExtension.title')}</div>
      <a
        className='text-primary-600 mb-2 flex h-[18px] items-center text-xs'
        href={t('common.apiBasedExtension.linkUrl') || '/'}
        target='_blank' rel='noopener noreferrer'
      >
        <BookOpen01 className='mr-1 h-3 w-3' />
        {t('common.apiBasedExtension.link')}
      </a>
    </div>
  )
}

export default Empty
