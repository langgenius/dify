'use client'

import type { FC } from 'react'
import type { Node } from 'reactflow'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import TabSlider from '@/app/components/base/tab-slider-plain'
import ReasoningConfigForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form'
import { getPlainValue, getStructureValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'

type ToolSettingsSectionProps = {
  currentProvider?: ToolWithProvider
  currentTool?: Tool
  value?: ToolValue
  nodeId?: string
  nodeOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  onChange?: (value: ToolValue) => void
}

const ToolSettingsSection: FC<ToolSettingsSectionProps> = ({
  currentProvider,
  currentTool,
  value,
  nodeId,
  nodeOutputVars = [],
  availableNodes = [],
  onChange,
}) => {
  const { t } = useTranslation()
  const [currType, setCurrType] = useState<'settings' | 'params'>('settings')
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
  const showTabSlider = allowReasoning && currentToolSettings.length > 0 && currentToolParams.length > 0
  const userSettingsOnly = currentToolSettings.length > 0 && (!allowReasoning || !currentToolParams.length)
  const reasoningConfigOnly = allowReasoning && currentToolParams.length > 0 && currentToolSettings.length === 0

  const handleSettingsFormChange = (v: Record<string, unknown>) => {
    if (!value || !onChange)
      return
    const newValue = getStructureValue(v)
    onChange({
      ...value,
      settings: newValue,
    })
  }

  const handleParamsFormChange = (v: Record<string, unknown>) => {
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

  return (
    <>
      <Divider className="my-1 w-full" />
      {/* tabs */}
      {showTabSlider && (
        <TabSlider
          className="mt-1 shrink-0 px-4"
          itemClassName="py-3"
          noBorderBottom
          smallItem
          value={currType}
          onChange={(value) => {
            setCurrType(value as 'settings' | 'params')
          }}
          options={[
            { value: 'settings', text: t('detailPanel.toolSelector.settings', { ns: 'plugin' })! },
            { value: 'params', text: t('detailPanel.toolSelector.params', { ns: 'plugin' })! },
          ]}
        />
      )}
      {showTabSlider && currType === 'params' && (
        <div className="px-4 py-2">
          <div className="text-text-tertiary system-xs-regular">{t('detailPanel.toolSelector.paramsTip1', { ns: 'plugin' })}</div>
          <div className="text-text-tertiary system-xs-regular">{t('detailPanel.toolSelector.paramsTip2', { ns: 'plugin' })}</div>
        </div>
      )}
      {/* user settings only */}
      {userSettingsOnly && (
        <div className="p-4 pb-1">
          <div className="text-text-primary system-sm-semibold-uppercase">{t('detailPanel.toolSelector.settings', { ns: 'plugin' })}</div>
        </div>
      )}
      {/* reasoning config only */}
      {reasoningConfigOnly && (
        <div className="mb-1 p-4 pb-1">
          <div className="text-text-primary system-sm-semibold-uppercase">{t('detailPanel.toolSelector.params', { ns: 'plugin' })}</div>
          <div className="pb-1">
            <div className="text-text-tertiary system-xs-regular">{t('detailPanel.toolSelector.paramsTip1', { ns: 'plugin' })}</div>
            <div className="text-text-tertiary system-xs-regular">{t('detailPanel.toolSelector.paramsTip2', { ns: 'plugin' })}</div>
          </div>
        </div>
      )}
      {/* user settings form */}
      {(currType === 'settings' || userSettingsOnly) && (
        <div className="px-4 py-2">
          <ToolForm
            inPanel
            readOnly={false}
            nodeId={safeNodeId}
            schema={settingsFormSchemas as CredentialFormSchema[]}
            value={getPlainValue((value?.settings || {}) as Record<string, { value: unknown }>) as ResourceVarInputs}
            onChange={handleSettingsFormChange}
          />
        </div>
      )}
      {/* reasoning config form */}
      {allowReasoning && (currType === 'params' || reasoningConfigOnly) && (
        <ReasoningConfigForm
          value={value?.parameters || {}}
          onChange={handleParamsFormChange}
          schemas={paramsFormSchemas as CredentialFormSchema[]}
          nodeOutputVars={nodeOutputVars}
          availableNodes={availableNodes}
          nodeId={safeNodeId}
        />
      )}
    </>
  )
}

export default React.memo(ToolSettingsSection)
