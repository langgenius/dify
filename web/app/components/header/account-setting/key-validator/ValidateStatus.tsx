import { useTranslation } from 'react-i18next'
import {
  RiErrorWarningFill,
} from '@remixicon/react'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'

export const ValidatedErrorIcon = () => {
  return <RiErrorWarningFill className='w-4 h-4 text-[#D92D20]' />
}

export const ValidatedSuccessIcon = () => {
  return <CheckCircle className='w-4 h-4 text-[#039855]' />
}

export const ValidatingTip = () => {
  const { t } = useTranslation()
  return (
    <div className={'mt-2 text-primary-600 text-xs font-normal'}>
      {t('common.provider.validating')}
    </div>
  )
}

export const ValidatedErrorMessage = ({ errorMessage }: { errorMessage: string }) => {
  const { t } = useTranslation()

  return (
    <div className={'mt-2 text-[#D92D20] text-xs font-normal'}>
      {t('common.provider.validatedError')}{errorMessage}
    </div>
  )
}
