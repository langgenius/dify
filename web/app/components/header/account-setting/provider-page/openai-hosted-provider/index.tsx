import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import cn from 'classnames'
import type { ProviderHosted } from '@/models/common'

interface IOpenaiHostedProviderProps {
  provider: ProviderHosted
}
const OpenaiHostedProvider = ({
  provider
}: IOpenaiHostedProviderProps) => {
  const { t } = useTranslation()
  const exhausted = provider.quota_used > provider.quota_limit
  
  return (
    <div className={`
      border-[0.5px] border-gray-200 rounded-xl
      ${exhausted ? 'bg-[#FFFBFA]' : 'bg-gray-50'}
    `}>
      <div className='pt-4 px-4 pb-3'>
        <div className='flex items-center mb-3'>
          <div className={s.icon} />
          <div className='grow text-sm font-medium text-gray-800'>
            {t('common.provider.openaiHosted.openaiHosted')}
          </div>
          <div className={`
            px-2 h-[22px] flex items-center rounded-md border 
            text-xs font-semibold 
            ${exhausted ? 'border-[#D92D20] text-[#D92D20]' : 'border-primary-600 text-primary-600'}
          `}>
            {exhausted ? t('common.provider.openaiHosted.exhausted') : t('common.provider.openaiHosted.onTrial')}
          </div>
        </div>
        <div className='text-[13px] text-gray-500'>{t('common.provider.openaiHosted.desc')}</div>
      </div>
      <div className='flex items-center h-[42px] px-4 border-t-[0.5px] border-t-[rgba(0, 0, 0, 0.05)]'>
        <div className='text-[13px] text-gray-700'>{t('common.provider.openaiHosted.callTimes')}</div>
        <div className='relative grow h-2 flex bg-gray-200 rounded-md mx-2 overflow-hidden'>
          <div 
            className={cn(s.bar, exhausted && s['bar-error'], 'absolute top-0 left-0 right-0 bottom-0')} 
            style={{ width: `${(provider.quota_used / provider.quota_limit * 100).toFixed(2)}%` }}
          />
          {Array(10).fill(0).map((i, k) => (
            <div key={k} className={s['bar-item']} />
          ))}
        </div>
        <div className={`
          text-[13px] font-medium ${exhausted ? 'text-[#D92D20]' : 'text-gray-700'}
        `}>{provider.quota_used}/{provider.quota_limit}</div>
      </div>
      {
        exhausted && (
          <div className='
            px-4 py-3 leading-[18px] flex items-center text-[13px] text-gray-700 font-medium
            bg-[#FFFAEB] border-t border-t-[rgba(0, 0, 0, 0.05)] rounded-b-xl
          '>
            {t('common.provider.openaiHosted.usedUp')}
          </div>
        )
      }
    </div>
  )
}

export default OpenaiHostedProvider