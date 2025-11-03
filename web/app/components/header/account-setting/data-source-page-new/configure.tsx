import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import {
  AddApiKeyButton,
  AddOAuthButton,
} from '@/app/components/plugins/plugin-auth'
import type { DataSourceAuth } from './types'
import type {
  AddApiKeyButtonProps,
  AddOAuthButtonProps,
  PluginPayload,
} from '@/app/components/plugins/plugin-auth/types'

type ConfigureProps = {
  item: DataSourceAuth
  pluginPayload: PluginPayload
  onUpdate?: () => void
  disabled?: boolean
}
const Configure = ({
  item,
  pluginPayload,
  onUpdate,
  disabled,
}: ConfigureProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const canApiKey = item.credential_schema?.length
  const oAuthData = item.oauth_schema || {}
  const canOAuth = oAuthData.client_schema?.length
  const oAuthButtonProps: AddOAuthButtonProps = useMemo(() => {
    return {
      buttonText: t('plugin.auth.addOAuth'),
      pluginPayload,
    }
  }, [pluginPayload, t])

  const apiKeyButtonProps: AddApiKeyButtonProps = useMemo(() => {
    return {
      pluginPayload,
      buttonText: t('plugin.auth.addApi'),
    }
  }, [pluginPayload, t])

  const handleToggle = useCallback(() => {
    setOpen(v => !v)
  }, [])

  const handleUpdate = useCallback(() => {
    setOpen(false)
    onUpdate?.()
  }, [onUpdate])

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
        offset={{
          mainAxis: 4,
          crossAxis: -4,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleToggle}>
          <Button
            variant='secondary-accent'
          >
            <RiAddLine className='h-4 w-4' />
            {t('common.dataSource.configure')}
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[61]'>
          <div className='w-[240px] space-y-1.5 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg'>
            {
              !!canOAuth && (
                <AddOAuthButton
                  {...oAuthButtonProps}
                  onUpdate={handleUpdate}
                  oAuthData={{
                    schema: oAuthData.client_schema || [],
                    is_oauth_custom_client_enabled: oAuthData.is_oauth_custom_client_enabled,
                    is_system_oauth_params_exists: oAuthData.is_system_oauth_params_exists,
                    client_params: oAuthData.oauth_custom_client_params,
                    redirect_uri: oAuthData.redirect_uri,
                  }}
                  disabled={disabled}
                />
              )
            }
            {
              !!canApiKey && !!canOAuth && (
                <div className='system-2xs-medium-uppercase flex h-4 items-center p-2 text-text-quaternary'>
                  <div className='mr-2 h-[1px] grow bg-gradient-to-l from-[rgba(16,24,40,0.08)]' />
                  OR
                  <div className='ml-2 h-[1px] grow bg-gradient-to-r from-[rgba(16,24,40,0.08)]' />
                </div>
              )
            }
            {
              !!canApiKey && (
                <AddApiKeyButton
                  {...apiKeyButtonProps}
                  formSchemas={item.credential_schema}
                  onUpdate={handleUpdate}
                  disabled={disabled}
                />
              )
            }
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}

export default memo(Configure)
