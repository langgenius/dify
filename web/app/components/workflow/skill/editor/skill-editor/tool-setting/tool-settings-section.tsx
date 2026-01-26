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

type ToolFormSchema = {
  variable: string
  type: string
  default?: unknown
  [key: string]: unknown
}

type ToolConfigValueItem = {
  auto?: 0 | 1
  value?: {
    type: VarKindType
    value?: unknown
  }
}

type ToolConfigValueMap = Record<string, ToolConfigValueItem>

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

  const settingsFormSchemas = useMemo(
    () => toolParametersToFormSchemas(currentToolSettings) as ToolFormSchema[],
    [currentToolSettings],
  )
  const paramsFormSchemas = useMemo(
    () => toolParametersToFormSchemas(currentToolParams) as ToolFormSchema[],
    [currentToolParams],
  )

  const handleSettingsFormChange = (v: ToolConfigValueMap) => {
    if (!value || !onChange)
      return
    onChange({
      ...value,
      settings: v,
    })
  }

  const handleParamsFormChange = (v: ToolConfigValueMap) => {
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
  const showParamsSection = currentToolParams.length > 0
  const getVarKindType = (type: FormTypeEnum | string) => {
    if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return VarKindType.variable
    if (type === FormTypeEnum.select || type === FormTypeEnum.checkbox || type === FormTypeEnum.textNumber || type === FormTypeEnum.array || type === FormTypeEnum.object)
      return VarKindType.constant
    if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
      return VarKindType.mixed
    return VarKindType.constant
  }
  const getSafeConfigValue = (rawValue: ToolConfigValueMap | undefined, schemas: ToolFormSchema[]) => {
    const nextValue: ToolConfigValueMap = { ...(rawValue || {}) }
    schemas.forEach((schema) => {
      const currentValue = nextValue[schema.variable]
      if (!currentValue) {
        nextValue[schema.variable] = {
          auto: 0,
          value: {
            type: getVarKindType(schema.type),
            value: schema.default ?? null,
          },
        }
        return
      }
      if (currentValue.auto === undefined)
        currentValue.auto = 0
      if (currentValue.value === undefined) {
        currentValue.value = {
          type: getVarKindType(schema.type),
          value: schema.default ?? null,
        }
      }
    })
    return nextValue
  }

  return (
    <>
      <Divider className="my-1 w-full" />
      <div className="px-4 pb-1 pt-3">
        <div className="system-sm-semibold-uppercase mb-1 text-text-primary">{t('detailPanel.toolSelector.reasoningConfig', { ns: 'plugin' })}</div>
        <div className="system-xs-regular text-text-tertiary">{t('detailPanel.toolSelector.paramsTip1', { ns: 'plugin' })}</div>
        <div className="system-xs-regular text-text-tertiary">{t('detailPanel.toolSelector.paramsTip2', { ns: 'plugin' })}</div>
      </div>
      {showSettingsSection && (
        <ReasoningConfigForm
          value={getSafeConfigValue(value?.settings as ToolConfigValueMap, settingsFormSchemas)}
          onChange={handleSettingsFormChange}
          schemas={settingsFormSchemas}
          nodeId={safeNodeId}
          disableVariableReference
        />
      )}
      {showParamsSection && (
        <ReasoningConfigForm
          value={getSafeConfigValue(value?.parameters as ToolConfigValueMap, paramsFormSchemas)}
          onChange={handleParamsFormChange}
          schemas={paramsFormSchemas}
          nodeId={safeNodeId}
          disableVariableReference
        />
      )}
    </>
  )
}

export default React.memo(ToolSettingsSection)
