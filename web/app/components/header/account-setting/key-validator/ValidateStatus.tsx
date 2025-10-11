import { useTranslation } from 'react-i18next'
import {
  RiErrorWarningFill,
} from '@remixicon/react'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'

export const ValidatedErrorIcon = () => {
  return <RiErrorWarningFill className='h-4 w-4 text-[#D92D20]' />
}

export const ValidatedSuccessIcon = () => {
  return <CheckCircle className='h-4 w-4 text-[#039855]' />
}

export const ValidatingTip = () => {
  const { t } = useTranslation()
  return (
    <div className={'mt-2 text-xs font-normal text-primary-600'}>
      {t('common.provider.validating')}
    </div>
  )
}

export const ValidatedErrorMessage = ({ errorMessage }: { errorMessage: string }) => {
  const { t } = useTranslation()

  return (
    <div className={'mt-2 text-xs font-normal text-[#D92D20]'}>
      {t('common.provider.validatedError')}{errorMessage}
    </div>
  )
}
