'use client'

import type { FC } from 'react'
import type { Tool } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ReasoningConfigForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'

type ToolSettingsSectionProps = {
  currentProvider?: ToolWithProvider
  currentTool?: Tool
  value?: ToolValue
  nodeId?: string
  onChange?: (value: ToolValue) => void
}

const ToolSettingsSection: FC<ToolSettingsSectionProps> = ({
  currentProvider,
  currentTool,
  value,
  nodeId,
  onChange,
}) => {
  const { t } = useTranslation()
  const safeNodeId = nodeId ?? ''

  const currentToolSettings = useMemo(() => {
    if (!currentTool)
      return []
    return currentTool.parameters?.filter(param => param.form !== 'llm') || []
  }, [currentTool])
  const currentToolParams = useMemo(() => {
    if (!currentTool)
      return []
    return currentTool.parameters?.filter(param => param.form === 'llm') || []
  }, [currentTool])

  const settingsFormSchemas = useMemo(() => toolParametersToFormSchemas(currentToolSettings), [currentToolSettings])
  const paramsFormSchemas = useMemo(() => toolParametersToFormSchemas(currentToolParams), [currentToolParams])

  const allowReasoning = !!safeNodeId
  const handleSettingsFormChange = (v: Record<string, any>) => {
    if (!value || !onChange)
      return
    onChange({
      ...value,
      settings: v,
    })
  }

  const handleParamsFormChange = (v: Record<string, any>) => {
    if (!value || !onChange)
      return
    onChange({
      ...value,
      parameters: v,
    })
  }

  if (!currentProvider?.is_team_authorization)
    return null

  if (!currentToolSettings.length && !currentToolParams.length)
    return null

  const showSettingsSection = currentToolSettings.length > 0
  const showParamsSection = allowReasoning && currentToolParams.length > 0
  const getVarKindType = (type: FormTypeEnum) => {
    if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return VarKindType.variable
    if (type === FormTypeEnum.select || type === FormTypeEnum.checkbox || type === FormTypeEnum.textNumber || type === FormTypeEnum.array || type === FormTypeEnum.object)
      return VarKindType.constant
    if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
      return VarKindType.mixed
    return VarKindType.constant
  }
  const getSafeConfigValue = (rawValue: Record<string, any> | undefined, schemas: any[]) => {
    const nextValue = { ...(rawValue || {}) }
    schemas.forEach((schema) => {
      if (!nextValue[schema.variable]) {
        nextValue[schema.variable] = {
          auto: 0,
          value: {
            type: getVarKindType(schema.type as FormTypeEnum),
            value: schema.default ?? null,
          },
        }
        return
      }
      if (nextValue[schema.variable].auto === undefined)
        nextValue[schema.variable].auto = 0
      if (nextValue[schema.variable].value === undefined) {
        nextValue[schema.variable].value = {
          type: getVarKindType(schema.type as FormTypeEnum),
          value: schema.default ?? null,
        }
      }
    })
    return nextValue
  }

  return (
    <>
      <Divider className="my-1 w-full" />
      {showSettingsSection && (
        <div className="p-4 pb-1">
          <div className="system-sm-semibold-uppercase text-text-primary">{t('detailPanel.toolSelector.settings', { ns: 'plugin' })}</div>
        </div>
      )}
      {showParamsSection && (
        <div className="mb-1 p-4 pb-1">
          <div className="system-sm-semibold-uppercase text-text-primary">{t('detailPanel.toolSelector.params', { ns: 'plugin' })}</div>
          <div className="pb-1">
            <div className="system-xs-regular text-text-tertiary">{t('detailPanel.toolSelector.paramsTip1', { ns: 'plugin' })}</div>
            <div className="system-xs-regular text-text-tertiary">{t('detailPanel.toolSelector.paramsTip2', { ns: 'plugin' })}</div>
          </div>
        </div>
      )}
      {showSettingsSection && (
        <ReasoningConfigForm
          value={getSafeConfigValue(value?.settings, settingsFormSchemas)}
          onChange={handleSettingsFormChange}
          schemas={settingsFormSchemas as any}
          nodeId={safeNodeId}
          disableVariableReference
        />
      )}
      {showParamsSection && (
        <ReasoningConfigForm
          value={getSafeConfigValue(value?.parameters, paramsFormSchemas)}
          onChange={handleParamsFormChange}
          schemas={paramsFormSchemas as any}
          nodeId={safeNodeId}
          disableVariableReference
        />
      )}
    </>
  )
}

export default React.memo(ToolSettingsSection)
