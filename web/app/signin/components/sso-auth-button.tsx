import { useTranslation } from 'react-i18next'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Button from '@/app/components/base/button'

export default function SSOAuthButton() {
  const { t } = useTranslation()
  return (
    <a href="">
      <Button
        className='w-full hover:!bg-gray-50'
      >
        <Lock01 className='mr-2 w-5 h-5 text-text-accent-light-mode-only' />
        <span className="truncate text-gray-800">{t('login.withSSO')}</span>
      </Button>
    </a>
  )
}
