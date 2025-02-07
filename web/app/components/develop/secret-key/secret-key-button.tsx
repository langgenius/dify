'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiKey2Line } from '@remixicon/react'
import Button from '@/app/components/base/button'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'

type ISecretKeyButtonProps = {
  className?: string
  appId?: string
  textCls?: string
}

const SecretKeyButton = ({ className, appId, textCls }: ISecretKeyButtonProps) => {
  const [isVisible, setVisible] = useState(false)
  const { t } = useTranslation()
  return (
    <>
      <Button
        className={`px-3 ${className}`}
        onClick={() => setVisible(true)}
        size='small'
        variant='ghost'
      >
        <div className={'flex items-center justify-center w-3.5 h-3.5'}>
          <RiKey2Line className='w-3.5 h-3.5 text-text-tertiary' />
        </div>
        <div className={`text-text-tertiary system-xs-medium px-[3px] ${textCls}`}>{t('appApi.apiKey')}</div>
      </Button>
      <SecretKeyModal isShow={isVisible} onClose={() => setVisible(false)} appId={appId} />
    </>
  )
}

export default SecretKeyButton
