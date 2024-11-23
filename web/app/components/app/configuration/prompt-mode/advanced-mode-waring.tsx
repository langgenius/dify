'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
type Props = {
  onReturnToSimpleMode: () => void
}

const AdvancedModeWarning: FC<Props> = ({
  onReturnToSimpleMode,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const [show, setShow] = React.useState(true)
  if (!show)
    return null
  return (
    <div className='mb-3 py-3 px-4 border border-[#FEF0C7] rounded-xl bg-[#FFFAEB]' >
      <div className='mb-2 text-xs leading-[18px] font-bold text-[#DC6803]'>{t('appDebug.promptMode.advancedWarning.title')}</div>
      <div className='flex justify-between items-center'>
        <div className='text-xs leading-[18px] '>
          <span className='text-gray-700'>{t('appDebug.promptMode.advancedWarning.description')}</span>
          <a
            className='font-medium text-[#155EEF]'
            href={`https://docs.dify.ai/${locale === LanguagesSupported[1] ? 'v/zh-hans/guides/application-design/prompt-engineering' : 'features/prompt-engineering'}`}
            target='_blank' rel='noopener noreferrer'
          >
            {t('appDebug.promptMode.advancedWarning.learnMore')}
          </a>
        </div>

        <div className='flex items-center space-x-1'>
          <div
            onClick={onReturnToSimpleMode}
            className='shrink-0 flex items-center h-6 px-2 bg-indigo-600 shadow-xs border border-gray-200 rounded-lg text-white text-xs font-semibold cursor-pointer space-x-1'
          >
            <div className='text-xs font-semibold uppercase'>{t('appDebug.promptMode.switchBack')}</div>
          </div>
          <div
            className='flex items-center h-6 px-2 rounded-md bg-[#fff] border border-gray-200 shadow-xs text-xs font-medium text-primary-600 cursor-pointer'
            onClick={() => setShow(false)}
          >{t('appDebug.promptMode.advancedWarning.ok')}</div>
        </div>

      </div>
    </div>
  )
}
export default React.memo(AdvancedModeWarning)
