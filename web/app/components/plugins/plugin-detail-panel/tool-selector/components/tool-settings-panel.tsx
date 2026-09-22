'use client'
import type { Node } from 'reactflow'
import type { TabType } from '../hooks/use-tool-selector'
import type { ReasoningConfigValue } from './reasoning-config-form'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'
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
function ParamsTips() {
  const { t } = useTranslation()
  return (
    <div className="pb-1">
      <div className="system-xs-regular text-text-tertiary">
        {t(($) => $['detailPanel.toolSelector.paramsTip1'], { ns: 'plugin' })}
      </div>
      <div className="system-xs-regular text-text-tertiary">
        {t(($) => $['detailPanel.toolSelector.paramsTip2'], { ns: 'plugin' })}
      </div>
    </div>
  )
}

export function ToolSettingsPanel({
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
}: ToolSettingsPanelProps) {
  const { t } = useTranslation()

  // Check if panel should be shown
  const hasSettings = settingsFormSchemas.length > 0
  const hasParams = paramsFormSchemas.length > 0
  const isTeamAuthorized = currentProvider?.is_team_authorization

  if ((!hasSettings && !hasParams) || !isTeamAuthorized) return null

  const settingsForm = (
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
  )
  const paramsForm = (
    <ReasoningConfigForm
      value={(value?.parameters || {}) as ReasoningConfigValue}
      onChange={onParamsFormChange}
      schemas={paramsFormSchemas}
      nodeOutputVars={nodeOutputVars}
      availableNodes={availableNodes}
      nodeId={nodeId}
    />
  )

  return (
    <>
      <Separator className="my-1 h-[0.5px]" />
      {nodeId && showTabSlider ? (
        <Tabs
          value={currType}
          onValueChange={(value) => {
            if (value === 'settings' || value === 'params') onCurrTypeChange(value)
          }}
        >
          <TabsList className="mt-1 px-4">
            <TabsTab value="settings">
              {t(($) => $['detailPanel.toolSelector.settings'], { ns: 'plugin' })}
            </TabsTab>
            <TabsTab value="params">
              {t(($) => $['detailPanel.toolSelector.params'], { ns: 'plugin' })}
            </TabsTab>
          </TabsList>
          <TabsPanel value="settings">{settingsForm}</TabsPanel>
          <TabsPanel value="params">
            <div className="px-4 py-2">
              <ParamsTips />
            </div>
            {paramsForm}
          </TabsPanel>
        </Tabs>
      ) : (
        <>
          {userSettingsOnly && (
            <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">
              {t(($) => $['detailPanel.toolSelector.settings'], { ns: 'plugin' })}
            </div>
          )}
          {nodeId && reasoningConfigOnly && (
            <div className="mb-1 p-4 pb-1">
              <div className="system-sm-semibold-uppercase text-text-primary">
                {t(($) => $['detailPanel.toolSelector.params'], { ns: 'plugin' })}
              </div>
              <ParamsTips />
            </div>
          )}
          {(currType === 'settings' || userSettingsOnly) && settingsForm}
          {nodeId && (currType === 'params' || reasoningConfigOnly) && paramsForm}
        </>
      )}
    </>
  )
}
