import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type QuotaCardProps = {
  remainTokens: number
}

const QuotaCard: FC<QuotaCardProps> = ({
  remainTokens,
}) => {
  const { t } = useTranslation()

  return (
    <div className='px-3 pb-3'>
      <div className='px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
        <div className='flex items-center h-[18px] text-xs font-medium text-gray-500'>
          {t('common.modelProvider.item.freeQuota')}
        </div>
        <div className='flex items-center h-5 text-sm font-medium text-gray-700'>
          {remainTokens}
          <div className='ml-1 font-normal'>Tokens</div>
        </div>
      </div>
    </div>
  )
}

export default QuotaCard
