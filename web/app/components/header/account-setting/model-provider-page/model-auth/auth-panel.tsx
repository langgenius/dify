import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
  RiMoreFill,
} from '@remixicon/react'
import type { ModelProvider } from '../declarations'
import {
  CustomConfigurationStatusEnum,
} from '../declarations'
import Indicator from '@/app/components/header/indicator'
import Button from '@/app/components/base/button'
import {
  AuthCategory,
  Authorized,
} from '@/app/components/plugins/plugin-auth'

type AuthPanelProps = {
  provider: ModelProvider
  onSetup: () => void
}
const AuthPanel: FC<AuthPanelProps> = ({
  provider,
  onSetup,
}) => {
  const authorized = false
  const { t } = useTranslation()
  const customConfig = provider.custom_configuration
  const isCustomConfigured = customConfig.status === CustomConfigurationStatusEnum.active

  const renderTrigger = useCallback(() => {
    return (
      <Button
        className='h-6 w-6'
        size='small'
      >
        <RiMoreFill className='h-4 w-4' />
      </Button>
    )
  }, [])

  return (
    <>
      {
        provider.provider_credential_schema && (
          <div className='relative ml-1 w-[112px] shrink-0 rounded-lg border-[0.5px] border-components-panel-border bg-white/[0.18] p-1'>
            <div className='system-xs-medium-uppercase mb-1 flex h-5 items-center justify-between pl-2 pr-[7px] pt-1 text-text-tertiary'>
              API-KEY
              <Indicator color={isCustomConfigured ? 'green' : 'red'} />
            </div>
            <div className='flex items-center gap-0.5'>
              <Button
                className='mr-0.5 grow'
                size='small'
                onClick={onSetup}
              >
                <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
                {
                  authorized ? t('common.operation.config') : t('common.operation.setup')
                }
              </Button>
              {
                authorized && (
                  <Authorized
                    pluginPayload={{
                      category: AuthCategory.model,
                      provider: provider.provider,
                    }}
                    credentials={[]}
                    renderTrigger={renderTrigger}
                  />
                )
              }
            </div>
          </div>
        )
      }
    </>
  )
}

export default AuthPanel
