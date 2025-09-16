'use client'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import ActionButton from '@/app/components/base/action-button'
import type { TriggerOAuthConfig } from '@/app/components/workflow/block-selector/types'

type Props = {
  supportedMethods: SupportedCreationMethods[]
  onClick: (type?: SupportedCreationMethods | typeof DEFAULT_METHOD) => void
  className?: string
  buttonType?: ButtonType
  oauthConfig?: TriggerOAuthConfig
}

export enum ButtonType {
  FULL_BUTTON = 'full-button',
  ICON_BUTTON = 'icon-button',
}

export const DEFAULT_METHOD = 'default'

const CreateSubscriptionButton = ({ supportedMethods, onClick, className, buttonType = ButtonType.FULL_BUTTON }: Props) => {
  const { t } = useTranslation()

  const buttonTextMap = useMemo(() => {
    return {
      [SupportedCreationMethods.OAUTH]: t('pluginTrigger.subscription.createButton.oauth'),
      [SupportedCreationMethods.APIKEY]: t('pluginTrigger.subscription.createButton.apiKey'),
      [SupportedCreationMethods.MANUAL]: t('pluginTrigger.subscription.createButton.manual'),
      [DEFAULT_METHOD]: t('pluginTrigger.subscription.empty.button'),
    }
  }, [t])

  if (supportedMethods.length === 0)
    return null

  const methodType = supportedMethods.length === 1 ? supportedMethods[0] : DEFAULT_METHOD

  return buttonType === ButtonType.FULL_BUTTON ? (
    <Button
      variant='primary'
      size='medium'
      className={className}
      onClick={() => onClick(methodType)}
    >
      <RiAddLine className='mr-2 h-4 w-4' />
      {buttonTextMap[methodType]}
    </Button>
  ) : <ActionButton onClick={() => onClick(methodType)}>
    <RiAddLine className='h-4 w-4' />
  </ActionButton>
}

export default CreateSubscriptionButton
