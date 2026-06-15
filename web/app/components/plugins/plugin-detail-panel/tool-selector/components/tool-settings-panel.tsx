'use client'
import type { FC } from 'react'
import type { Node } from 'reactflow'
import type { TabType } from '../hooks/use-tool-selector-state'
import type { ReasoningConfigValue } from './reasoning-config-form'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import TabSlider from '@/app/components/base/tab-slider-plain'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import ReasoningConfigForm from './reasoning-config-form'

type ToolSettingsPanelProps = {
  value?: ToolValue
  currentProvider?: ToolWithProvider
  nodeId: string
  currType: TabType
  settingsFormSchemas: ToolFormSchema[]
  paramsFormSchemas: ToolFormSchema[]
  settingsValue: ToolVarInputs
  showTabSlider: boolean
  userSettingsOnly: boolean
  reasoningConfigOnly: boolean
  nodeOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  onCurrTypeChange: (type: TabType) => void
  onSettingsFormChange: (v: ToolVarInputs) => void
  onParamsFormChange: (v: ReasoningConfigValue) => void
}

/**
 * Renders the settings/params tips section
 */
const ParamsTips: FC = () => {
  const { t } = useTranslation()
  return (
    <div className="pb-1">
      <div className="system-xs-regular text-text-tertiary">
        {t('detailPanel.toolSelector.paramsTip1', { ns: 'plugin' })}
      </div>
      <div className="system-xs-regular text-text-tertiary">
        {t('detailPanel.toolSelector.paramsTip2', { ns: 'plugin' })}
      </div>
    </div>
  )
}

const ToolSettingsPanel: FC<ToolSettingsPanelProps> = ({
  value,
  currentProvider,
  nodeId,
  currType,
  settingsFormSchemas,
  paramsFormSchemas,
  settingsValue,
  showTabSlider,
  userSettingsOnly,
  reasoningConfigOnly,
  nodeOutputVars,
  availableNodes,
  onCurrTypeChange,
  onSettingsFormChange,
  onParamsFormChange,
}) => {
  const { t } = useTranslation()

  // Check if panel should be shown
  const hasSettings = settingsFormSchemas.length > 0
  const hasParams = paramsFormSchemas.length > 0
  const isTeamAuthorized = currentProvider?.is_team_authorization

  if ((!hasSettings && !hasParams) || !isTeamAuthorized)
    return null

  return (
    <>
      <Divider className="my-1 w-full" />

      {/* Tab slider - shown only when both settings and params exist */}
      {nodeId && showTabSlider && (
        <TabSlider
          className="mt-1 shrink-0 px-4"
          itemClassName="py-3"
          noBorderBottom
          smallItem
          value={currType}
          onChange={(v) => {
            if (v === 'settings' || v === 'params')
              onCurrTypeChange(v)
          }}
          options={[
            { value: 'settings', text: t('detailPanel.toolSelector.settings', { ns: 'plugin' })! },
            { value: 'params', text: t('detailPanel.toolSelector.params', { ns: 'plugin' })! },
          ]}
        />
      )}

      {/* Params tips when tab slider and params tab is active */}
      {nodeId && showTabSlider && currType === 'params' && (
        <div className="px-4 py-2">
          <ParamsTips />
        </div>
      )}

      {/* User settings only header */}
      {userSettingsOnly && (
        <div className="p-4 pb-1">
          <div className="system-sm-semibold-uppercase text-text-primary">
            {t('detailPanel.toolSelector.settings', { ns: 'plugin' })}
          </div>
        </div>
      )}

      {/* Reasoning config only header */}
      {nodeId && reasoningConfigOnly && (
        <div className="mb-1 p-4 pb-1">
          <div className="system-sm-semibold-uppercase text-text-primary">
            {t('detailPanel.toolSelector.params', { ns: 'plugin' })}
          </div>
          <ParamsTips />
        </div>
      )}

      {/* User settings form */}
      {(currType === 'settings' || userSettingsOnly) && (
        <div className="px-4 py-2">
          <ToolForm
            inPanel
            readOnly={false}
            nodeId={nodeId}
            schema={settingsFormSchemas as CredentialFormSchema[]}
            value={settingsValue}
            onChange={onSettingsFormChange}
          />
        </div>
      )}

      {/* Reasoning config form */}
      {nodeId && (currType === 'params' || reasoningConfigOnly) && (
        <ReasoningConfigForm
          value={(value?.parameters || {}) as ReasoningConfigValue}
          onChange={onParamsFormChange}
          schemas={paramsFormSchemas}
          nodeOutputVars={nodeOutputVars}
          availableNodes={availableNodes}
          nodeId={nodeId}
        />
      )}
    </>
  )
}

export default ToolSettingsPanel
