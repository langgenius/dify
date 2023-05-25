import Link from 'next/link'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'

export const ValidatedErrorIcon = () => {
  return <ExclamationCircleIcon className='w-4 h-4 text-[#D92D20]' />
}

export const ValidatedSuccessIcon = () => {
  return <CheckCircleIcon className='w-4 h-4 text-[#039855]' />
}

export const ValidatingTip = () => {
  const { t } = useTranslation()
  return (
    <div className={`mt-2 text-primary-600 text-xs font-normal`}>
      {t('common.provider.validating')}
    </div>
  )
}

export const ValidatedExceedOnOpenaiTip = () => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  return (
    <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
      {t('common.provider.apiKeyExceedBill')}&nbsp;
      <Link 
        className='underline'
        href="https://platform.openai.com/account/api-keys" 
        target={'_blank'}>
        {locale === 'en' ? 'this link' : '这篇文档'}
      </Link>
    </div>
  )
}

export const ValidatedErrorOnOpenaiTip = ({ errorMessage }: { errorMessage: string }) => {
  const { t } = useTranslation()

  return (
    <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
      {t('common.provider.validatedError')}{errorMessage}
    </div>
  )
}

export const ValidatedErrorOnAzureOpenaiTip = ({ errorMessage }: { errorMessage: string }) => {
  const { t } = useTranslation()

  return (
    <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
      {t('common.provider.validatedError')}{errorMessage}
    </div>
  )
}