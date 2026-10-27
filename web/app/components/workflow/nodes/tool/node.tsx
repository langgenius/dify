import type { FC } from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { VariableLabelInNode } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodePluginInstallation } from '../../hooks/use-node-plugin-installation'
import { isToolAuthorizationRequired } from './auth'
import useCurrentToolCollection from './hooks/use-current-tool-collection'

const Node: FC<NodeProps<ToolNodeType>> = ({ data }) => {
  const { t } = useTranslation(['workflow'])
  const { tool_configurations, paramSchemas } = data
  const toolConfigs = Object.keys(tool_configurations || {})
  const nodes = useNodes()
  const { isChecking, isMissing, uniqueIdentifier, canInstall, onInstallSuccess, shouldDim } =
    useNodePluginInstallation(data)
  const { currCollection } = useCurrentToolCollection(data.provider_type, data.provider_id)
  const showInstallButton = !isChecking && isMissing && canInstall && uniqueIdentifier
  const showAuthorizationWarning = isToolAuthorizationRequired(data.provider_type, currCollection)

  const hasConfigs = toolConfigs.length > 0

  if (!showInstallButton && !hasConfigs && !showAuthorizationWarning) return null

  return (
    <div className="relative mb-1 px-3 py-1">
      {showInstallButton && (
        <div className="pointer-events-auto absolute inset-e-3 -top-8 z-40">
          <InstallPluginButton
            size="small"
            className="font-medium! text-text-accent!"
            extraIdentifiers={
              [data.plugin_id, data.provider_id, data.provider_name].filter(Boolean) as string[]
            }
            uniqueIdentifier={uniqueIdentifier!}
            onSuccess={onInstallSuccess}
          />
        </div>
      )}
      {(hasConfigs || showAuthorizationWarning) && (
        <div className="space-y-0.5" aria-disabled={shouldDim}>
          {hasConfigs &&
            toolConfigs.map((key) => {
              const config = tool_configurations[key]
              const schemaType = paramSchemas?.find((i) => i.name === key)?.type
              const { value } = config
              // A file param bound to an upstream variable holds a
              // [nodeId, varName] reference; render it through the variable
              // label so users see the source node's title, not a raw id.
              const isVariableRef = schemaType === FormTypeEnum.file && Array.isArray(value)
              const variable = isVariableRef ? (value as [string, string]) : null
              const sourceNode = variable
                ? isSystemVar(variable)
                  ? nodes.find((node) => node.data.type === BlockEnum.Start)
                  : nodes.find((node) => node.id === variable[0])
                : undefined
              // A model-selector param stores its picked model as a constant
              // object ({ provider, model, ... }); surface just the model name.
              const modelDisplay =
                schemaType === FormTypeEnum.modelSelector
                  ? value && typeof value === 'object' && !Array.isArray(value)
                    ? (value as { model?: string }).model
                    : undefined
                  : config?.type === FormTypeEnum.modelSelector
                    ? config?.model
                    : undefined
              return (
                <div
                  key={key}
                  className="flex h-6 items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary"
                >
                  <div
                    title={key}
                    className="max-w-25 shrink-0 truncate text-xs font-medium text-text-tertiary uppercase"
                  >
                    {key}
                  </div>
                  {typeof value === 'string' && (
                    <div
                      title={value}
                      className="w-0 shrink-0 grow truncate text-end text-xs font-normal text-text-secondary"
                    >
                      {schemaType === FormTypeEnum.secretInput ? '********' : value}
                    </div>
                  )}
                  {typeof value === 'number' && (
                    <div
                      title={Number.isNaN(value) ? '' : value}
                      className="w-0 shrink-0 grow truncate text-end text-xs font-normal text-text-secondary"
                    >
                      {Number.isNaN(value) ? '' : value}
                    </div>
                  )}
                  {Array.isArray(value) && !isVariableRef && (
                    <div
                      title={value.join(', ')}
                      className="w-0 shrink-0 grow truncate text-end text-xs font-normal text-text-secondary"
                    >
                      {value.join(', ')}
                    </div>
                  )}
                  {isVariableRef && (
                    <div
                      title={sourceNode?.data.title}
                      className="w-0 shrink-0 grow truncate text-end text-xs font-normal text-text-secondary"
                    >
                      <VariableLabelInNode
                        variables={variable!}
                        nodeType={sourceNode?.data.type}
                        nodeTitle={sourceNode?.data.title}
                      />
                    </div>
                  )}
                  {modelDisplay !== undefined && modelDisplay !== null && (
                    <div
                      title={modelDisplay}
                      className="w-0 shrink-0 grow truncate text-end text-xs font-normal text-text-secondary"
                    >
                      {modelDisplay}
                    </div>
                  )}
                </div>
              )
            })}
          {showAuthorizationWarning && (
            <div className="flex h-6 items-center rounded-md border-[0.5px] border-state-warning-active bg-state-warning-hover px-1.5">
              <span className="me-1 size-1 shrink-0 rounded-xs bg-text-warning-secondary" />
              <div
                className="grow truncate system-xs-medium text-text-warning"
                title={t(($) => $['nodes.tool.authorizationRequired'], { ns: 'workflow' })}
              >
                {t(($) => $['nodes.tool.authorizationRequired'], { ns: 'workflow' })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
