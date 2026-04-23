import type { DataSourceAuth } from './types'
import type {
  AddApiKeyButtonProps,
  AddOAuthButtonProps,
  PluginPayload,
} from '@/app/components/plugins/plugin-auth/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiAddLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddApiKeyButton,
  AddOAuthButton,
} from '@/app/components/plugins/plugin-auth'

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
      buttonText: t('auth.addOAuth', { ns: 'plugin' }),
      pluginPayload,
    }
  }, [pluginPayload, t])

  const apiKeyButtonProps: AddApiKeyButtonProps = useMemo(() => {
    return {
      pluginPayload,
      buttonText: t('auth.addApi', { ns: 'plugin' }),
    }
  }, [pluginPayload, t])

  const handleUpdate = useCallback(() => {
    setOpen(false)
    onUpdate?.()
  }, [onUpdate])

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          render={(
            <Button
              variant="secondary-accent"
            >
              <RiAddLine className="h-4 w-4" />
              {t('dataSource.configure', { ns: 'common' })}
            </Button>
          )}
        />
        <PopoverContent
          placement="bottom-end"
          sideOffset={4}
          alignOffset={-4}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div className="w-[240px] space-y-1.5 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-lg">
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
                <div className="flex h-4 items-center p-2 system-2xs-medium-uppercase text-text-quaternary">
                  <div className="mr-2 h-px grow bg-linear-to-l from-[rgba(16,24,40,0.08)]" />
                  OR
                  <div className="ml-2 h-px grow bg-linear-to-r from-[rgba(16,24,40,0.08)]" />
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
        </PopoverContent>
      </Popover>
    </>
  )
}

export default memo(Configure)
