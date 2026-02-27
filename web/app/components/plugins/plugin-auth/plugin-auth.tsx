import type { PluginPayload } from './types'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import Authorize from './authorize'
import Authorized from './authorized'
import { usePluginAuth } from './hooks/use-plugin-auth'

type PluginAuthProps = {
  pluginPayload: PluginPayload
  children?: React.ReactNode
  className?: string
}
const PluginAuth = ({
  pluginPayload,
  children,
  className,
}: PluginAuthProps) => {
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    disabled,
    invalidPluginCredentialInfo,
    notAllowCustomCredential,
  } = usePluginAuth(pluginPayload, !!pluginPayload.provider)

  return (
    <div className={cn(!isAuthorized && className)}>
      {
        !isAuthorized && (
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
            onUpdate={invalidPluginCredentialInfo}
            notAllowCustomCredential={notAllowCustomCredential}
          />
        )
      }
      {
        isAuthorized && !children && (
          <Authorized
            pluginPayload={pluginPayload}
            credentials={credentials}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
            onUpdate={invalidPluginCredentialInfo}
            notAllowCustomCredential={notAllowCustomCredential}
          />
        )
      }
      {
        isAuthorized && children
      }
    </div>
  )
}

export default memo(PluginAuth)
