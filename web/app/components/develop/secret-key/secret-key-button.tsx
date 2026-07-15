'use client'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'

type ISecretKeyButtonProps = {
  className?: string
  appId?: string
  textCls?: string
  canManage?: boolean
}

const SecretKeyButton = ({
  className,
  appId,
  textCls,
  canManage = false,
}: ISecretKeyButtonProps) => {
  const [isVisible, setIsVisible] = useState(false)
  const { t } = useTranslation()

  return (
    <>
      <Button
        className={`px-3 ${className}`}
        onClick={() => setIsVisible(true)}
        size="small"
        variant="ghost"
        disabled={!canManage}
      >
        <div className="flex size-3.5 items-center justify-center">
          <span className="i-ri-key-2-line size-3.5 text-text-tertiary" />
        </div>
        <div className={`px-[3px] system-xs-medium text-text-tertiary ${textCls}`}>
          {t(($) => $.apiKey, { ns: 'appApi' })}
        </div>
      </Button>
      <SecretKeyModal
        isShow={isVisible}
        onClose={() => setIsVisible(false)}
        appId={appId}
        canManage={canManage}
      />
    </>
  )
}

export default SecretKeyButton
