import type { AppUserAuthDraft, AuthorizationTab } from './app-user-auth/draft'
import type { ReuseFromNodeProps } from './reuse-from-node'
import type { PluginPayload } from './types'
import type { ConnectionSelectorProps } from './workspace-auth/connection-selector'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppUserAuth from './app-user-auth'
import { createAppUserAuthDraft } from './app-user-auth/draft'
import { usePluginAuth } from './hooks/use-plugin-auth'
import ReuseFromNode from './reuse-from-node'
import WorkspaceAuth from './workspace-auth'

export type PluginAuthProps = {
  pluginPayload: PluginPayload
  nodeAuth?: Omit<ConnectionSelectorProps, 'pluginPayload' | 'authorization'>
  className?: string
  showAuthorizationTabs?: boolean
  authorizationTab?: AuthorizationTab
  onAuthorizationTabChange?: (tab: AuthorizationTab) => void
  appUserAuth?: {
    draft?: AppUserAuthDraft
    onChange: (draft: AppUserAuthDraft) => void
  }
  reuseFromNode?: ReuseFromNodeProps
}
const authorizationTabClassName =
  'min-h-8 min-w-0 flex-1 justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-2 py-1.5 text-center system-sm-regular wrap-anywhere text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover data-active:border-components-option-card-option-selected-border data-active:bg-components-option-card-option-selected-bg data-active:system-sm-medium data-active:shadow-xs data-active:inset-ring-[0.5px] data-active:inset-ring-components-option-card-option-selected-border'

const PluginAuth = ({
  pluginPayload,
  nodeAuth,
  className,
  showAuthorizationTabs = false,
  authorizationTab,
  onAuthorizationTabChange,
  appUserAuth,
  reuseFromNode,
}: PluginAuthProps) => {
  const { t } = useTranslation(['plugin'])
  const labelId = useId()
  const authorization = usePluginAuth(
    pluginPayload,
    !!pluginPayload.provider,
    nodeAuth?.credentialId ? [nodeAuth.credentialId] : undefined,
  )

  if (!showAuthorizationTabs) {
    return (
      <div className={cn(!authorization.isAuthorized && className)}>
        <WorkspaceAuth
          pluginPayload={pluginPayload}
          authorization={authorization}
          nodeAuth={nodeAuth}
        />
      </div>
    )
  }

  return (
    <Tabs
      defaultValue="workspace-auth"
      value={authorizationTab}
      onValueChange={(tab) => {
        if (tab !== 'workspace-auth' && tab !== 'app-user-auth' && tab !== 'reuse-from-node') return
        if (tab === 'app-user-auth' && appUserAuth && !appUserAuth.draft) {
          appUserAuth.onChange(
            createAppUserAuthDraft({
              canOAuth: !!authorization.canOAuth,
              canApiKey: !!authorization.canApiKey,
            }),
          )
        }
        onAuthorizationTabChange?.(tab)
      }}
      className="pt-2"
    >
      <div className="space-y-2 px-4 py-2">
        <div className="flex h-6 items-center gap-0.5">
          <h3 id={labelId} className="system-xs-medium-uppercase text-text-secondary">
            {t(($) => $['auth.authorization'], { ns: 'plugin' })}
          </h3>
          <Infotip>
            <InfotipTrigger aria-labelledby={labelId} className="size-4" />
            <InfotipContent aria-labelledby={labelId}>
              {t(($) => $['auth.useApiAuthDesc'], { ns: 'plugin' })}
            </InfotipContent>
          </Infotip>
        </div>
        <TabsList aria-labelledby={labelId} className="gap-2">
          <TabsTab value="workspace-auth" className={authorizationTabClassName}>
            {t(($) => $['auth.workspaceAuth'], { ns: 'plugin' })}
          </TabsTab>
          <TabsTab
            value="app-user-auth"
            disabled={authorization.isLoading}
            className={authorizationTabClassName}
          >
            {t(($) => $['auth.appUserAuth'], { ns: 'plugin' })}
          </TabsTab>
          <TabsTab value="reuse-from-node" className={authorizationTabClassName}>
            {t(($) => $['auth.reuseFromNode'], { ns: 'plugin' })}
          </TabsTab>
        </TabsList>
      </div>
      <TabsPanel value="workspace-auth" className={cn('px-4 py-2', className)}>
        <WorkspaceAuth
          pluginPayload={pluginPayload}
          authorization={authorization}
          nodeAuth={nodeAuth}
          showDescription
        />
      </TabsPanel>
      <TabsPanel value="app-user-auth" keepMounted className="px-4 py-2 data-hidden:hidden">
        {!authorization.isLoading && (
          <AppUserAuth
            key={`${pluginPayload.category}/${pluginPayload.provider}/${authorization.canOAuth}/${authorization.canApiKey}`}
            canOAuth={!!authorization.canOAuth}
            canApiKey={!!authorization.canApiKey}
            providerName={nodeAuth?.providerName}
            value={appUserAuth?.draft}
            onChange={appUserAuth?.onChange}
          />
        )}
      </TabsPanel>
      <TabsPanel value="reuse-from-node" className="px-4 py-2">
        <ReuseFromNode {...reuseFromNode} />
      </TabsPanel>
    </Tabs>
  )
}

export default memo(PluginAuth)
