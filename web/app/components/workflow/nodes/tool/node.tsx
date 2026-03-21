import type { FC } from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { isToolAuthorizationRequired } from './auth'
import useCurrentToolCollection from './hooks/use-current-tool-collection'

const Node: FC<NodeProps<ToolNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()
  const { tool_configurations, paramSchemas } = data
  const toolConfigs = Object.keys(tool_configurations || {})
  const {
    isChecking,
    isMissing,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  } = useNodePluginInstallation(data)
  const { currCollection } = useCurrentToolCollection(data.provider_type, data.provider_id)
  const showInstallButton = !isChecking && isMissing && canInstall && uniqueIdentifier
  const showAuthorizationWarning = isToolAuthorizationRequired(data.provider_type, currCollection)

  const hasConfigs = toolConfigs.length > 0

  if (!showInstallButton && !hasConfigs && !showAuthorizationWarning)
    return null

  return (
    <div className="relative mb-1 px-3 py-1">
      {showInstallButton && (
        <div className="pointer-events-auto absolute right-3 top-[-32px] z-40">
          <InstallPluginButton
            size="small"
            className="!font-medium !text-text-accent"
            extraIdentifiers={[
              data.plugin_id,
              data.provider_id,
              data.provider_name,
            ].filter(Boolean) as string[]}
            uniqueIdentifier={uniqueIdentifier!}
            onSuccess={onInstallSuccess}
          />
        </div>
      )}
      {(hasConfigs || showAuthorizationWarning) && (
        <div className="space-y-0.5" aria-disabled={shouldDim}>
          {hasConfigs && toolConfigs.map(key => (
            <div key={key} className="flex h-6 items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary">
              <div title={key} className="max-w-[100px] shrink-0 truncate text-xs font-medium uppercase text-text-tertiary">
                {key}
              </div>
              {typeof tool_configurations[key].value === 'string' && (
                <div title={tool_configurations[key].value} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {paramSchemas?.find(i => i.name === key)?.type === FormTypeEnum.secretInput ? '********' : tool_configurations[key].value}
                </div>
              )}
              {typeof tool_configurations[key].value === 'number' && (
                <div title={Number.isNaN(tool_configurations[key].value) ? '' : tool_configurations[key].value} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {Number.isNaN(tool_configurations[key].value) ? '' : tool_configurations[key].value}
                </div>
              )}
              {typeof tool_configurations[key] !== 'string' && tool_configurations[key]?.type === FormTypeEnum.modelSelector && (
                <div title={tool_configurations[key].model} className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary">
                  {tool_configurations[key].model}
                </div>
              )}
            </div>
          ))}
          {showAuthorizationWarning && (
            <div className="flex h-6 items-center rounded-md border-[0.5px] border-state-warning-active bg-state-warning-hover px-1.5">
              <span className="mr-1 size-[4px] shrink-0 rounded-[2px] bg-text-warning-secondary" />
              <div className="grow truncate text-text-warning system-xs-medium" title={t('nodes.tool.authorizationRequired', { ns: 'workflow' })}>
                {t('nodes.tool.authorizationRequired', { ns: 'workflow' })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
