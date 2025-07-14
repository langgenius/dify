import { memo } from 'react'
import Authorize from './authorize'
import Authorized from './authorized'
import type { PluginPayload } from './types'
import { usePluginAuth } from './hooks/use-plugin-auth'

type PluginAuthProps = {
  pluginPayload: PluginPayload
  children?: React.ReactNode
}
const PluginAuth = ({
  pluginPayload,
  children,
}: PluginAuthProps) => {
  const {
    isAuthorized,
    canOAuth,
    canApiKey,
    credentials,
    disabled,
  } = usePluginAuth(pluginPayload, !!pluginPayload.provider)

  return (
    <>
      {
        !isAuthorized && (
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={canOAuth}
            canApiKey={canApiKey}
            disabled={disabled}
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
          />
        )
      }
      {
        isAuthorized && children
      }
    </>
  )
}

export default memo(PluginAuth)
