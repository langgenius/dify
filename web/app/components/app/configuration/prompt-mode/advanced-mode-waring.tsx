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
    <div className='mb-3 rounded-xl border border-[#FEF0C7] bg-[#FFFAEB] px-4 py-3' >
      <div className='mb-2 text-xs font-bold leading-[18px] text-[#DC6803]'>{t('appDebug.promptMode.advancedWarning.title')}</div>
      <div className='flex items-center justify-between'>
        <div className='text-xs leading-[18px] '>
          <span className='text-gray-700'>{t('appDebug.promptMode.advancedWarning.description')}</span>
          <a
            className='font-medium text-[#155EEF]'
            href={`https://docs.dify.ai/${locale === LanguagesSupported[1] ? '/guides/features/prompt-engineering' : 'features/prompt-engineering'}`}
            target='_blank' rel='noopener noreferrer'
          >
            {t('appDebug.promptMode.advancedWarning.learnMore')}
          </a>
        </div>

        <div className='flex items-center space-x-1'>
          <div
            onClick={onReturnToSimpleMode}
            className='flex h-6 shrink-0 cursor-pointer items-center space-x-1 rounded-lg border border-gray-200 bg-indigo-600 px-2 text-xs font-semibold text-white shadow-xs'
          >
            <div className='text-xs font-semibold uppercase'>{t('appDebug.promptMode.switchBack')}</div>
          </div>
          <div
            className='flex h-6 cursor-pointer items-center rounded-md border border-gray-200 bg-[#fff] px-2 text-xs font-medium text-primary-600 shadow-xs'
            onClick={() => setShow(false)}
          >{t('appDebug.promptMode.advancedWarning.ok')}</div>
        </div>

      </div>
    </div>
  )
}
export default React.memo(AdvancedModeWarning)
