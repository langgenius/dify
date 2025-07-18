'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ToolTrigger from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-trigger'
import ToolItem from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-item'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import Textarea from '@/app/components/base/textarea'
import Divider from '@/app/components/base/divider'
import TabSlider from '@/app/components/base/tab-slider-plain'
import ReasoningConfigForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form'
import { generateFormValue, getPlainValue, getStructureValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
} from '@/service/use-tools'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { usePluginInstalledCheck } from '@/app/components/plugins/plugin-detail-panel/tool-selector/hooks'
import { CollectionType } from '@/app/components/tools/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import type { Node } from 'reactflow'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import {
  AuthCategory,
  PluginAuthInAgent,
} from '@/app/components/plugins/plugin-auth'

type Props = {
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  scope?: string
  value?: ToolValue
  selectedTools?: ToolValue[]
  onSelect: (tool: ToolValue) => void
  onSelectMultiple?: (tool: ToolValue[]) => void
  isEdit?: boolean
  onDelete?: () => void
  supportEnableSwitch?: boolean
  supportAddCustomTool?: boolean
  trigger?: React.ReactNode
  controlledState?: boolean
  onControlledStateChange?: (state: boolean) => void
  panelShowState?: boolean
  onPanelShowStateChange?: (state: boolean) => void
  nodeOutputVars: NodeOutPutVar[],
  availableNodes: Node[],
  nodeId?: string,
  canChooseMCPTool?: boolean,
}
const ToolSelector: FC<Props> = ({
  value,
  selectedTools,
  isEdit,
  disabled,
  placement = 'left',
  offset = 4,
  onSelect,
  onSelectMultiple,
  onDelete,
  scope,
  supportEnableSwitch,
  trigger,
  controlledState,
  onControlledStateChange,
  panelShowState,
  onPanelShowStateChange,
  nodeOutputVars,
  availableNodes,
  nodeId = '',
  canChooseMCPTool,
}) => {
  const { t } = useTranslation()
  const [isShow, onShowChange] = useState(false)
  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const invalidateAllBuiltinTools = useInvalidateAllBuiltInTools()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  // plugin info check
  const { inMarketPlace, manifest } = usePluginInstalledCheck(value?.provider_name)

  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || []), ...(mcpTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.id === value?.provider_name
    })
  }, [value, buildInTools, customTools, workflowTools, mcpTools])

  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const getToolValue = (tool: ToolDefaultValue) => {
    const settingValues = generateFormValue(tool.params, toolParametersToFormSchemas(tool.paramSchemas.filter(param => param.form !== 'llm') as any))
    const paramValues = generateFormValue(tool.params, toolParametersToFormSchemas(tool.paramSchemas.filter(param => param.form === 'llm') as any), true)
    return {
      provider_name: tool.provider_id,
      provider_show_name: tool.provider_name,
      type: tool.provider_type,
      tool_name: tool.tool_name,
      tool_label: tool.tool_label,
      tool_description: tool.tool_description,
      settings: settingValues,
      parameters: paramValues,
      enabled: tool.is_team_authorization,
      extra: {
        description: tool.tool_description,
      },
      schemas: tool.paramSchemas,
    }
  }
  const handleSelectTool = (tool: ToolDefaultValue) => {
    const toolValue = getToolValue(tool)
    onSelect(toolValue)
    // setIsShowChooseTool(false)
  }
  const handleSelectMultipleTool = (tool: ToolDefaultValue[]) => {
    const toolValues = tool.map(item => getToolValue(item))
    onSelectMultiple?.(toolValues)
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onSelect({
      ...value,
      extra: {
        ...value?.extra,
        description: e.target.value || '',
      },
    } as any)
  }

  // tool settings & params
  const currentToolSettings = useMemo(() => {
    if (!currentProvider) return []
    return currentProvider.tools.find(tool => tool.name === value?.tool_name)?.parameters.filter(param => param.form !== 'llm') || []
  }, [currentProvider, value])
  const currentToolParams = useMemo(() => {
    if (!currentProvider) return []
    return currentProvider.tools.find(tool => tool.name === value?.tool_name)?.parameters.filter(param => param.form === 'llm') || []
  }, [currentProvider, value])
  const [currType, setCurrType] = useState('settings')
  const showTabSlider = currentToolSettings.length > 0 && currentToolParams.length > 0
  const userSettingsOnly = currentToolSettings.length > 0 && !currentToolParams.length
  const reasoningConfigOnly = currentToolParams.length > 0 && !currentToolSettings.length

  const settingsFormSchemas = useMemo(() => toolParametersToFormSchemas(currentToolSettings), [currentToolSettings])
  const paramsFormSchemas = useMemo(() => toolParametersToFormSchemas(currentToolParams), [currentToolParams])

  const handleSettingsFormChange = (v: Record<string, any>) => {
    const newValue = getStructureValue(v)
    const toolValue = {
      ...value,
      settings: newValue,
    }
    onSelect(toolValue as any)
  }
  const handleParamsFormChange = (v: Record<string, any>) => {
    const toolValue = {
      ...value,
      parameters: v,
    }
    onSelect(toolValue as any)
  }

  const handleEnabledChange = (state: boolean) => {
    onSelect({
      ...value,
      enabled: state,
    } as any)
  }

  // install from marketplace
  const currentTool = useMemo(() => {
    return currentProvider?.tools.find(tool => tool.name === value?.tool_name)
  }, [currentProvider?.tools, value?.tool_name])
  const manifestIcon = useMemo(() => {
    if (!manifest)
      return ''
    return `${MARKETPLACE_API_PREFIX}/plugins/${(manifest as any).plugin_id}/icon`
  }, [manifest])
  const handleInstall = async () => {
    invalidateAllBuiltinTools()
    invalidateInstalledPluginList()
  }
  const handleAuthorizationItemClick = (id: string) => {
    onSelect({
      ...value,
      credential_id: id,
    } as any)
  }

  return (
    <>
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={trigger ? controlledState : isShow}
        onOpenChange={trigger ? onControlledStateChange : onShowChange}
      >
        <PortalToFollowElemTrigger
          className='w-full'
          onClick={() => {
            if (!currentProvider || !currentTool) return
            handleTriggerClick()
          }}
        >
          {trigger}
          {!trigger && !value?.provider_name && (
            <ToolTrigger
              isConfigure
              open={isShow}
              value={value}
              provider={currentProvider}
            />
          )}
          {!trigger && value?.provider_name && (
            <ToolItem
              open={isShow}
              icon={currentProvider?.icon || manifestIcon}
              isMCPTool={currentProvider?.type === CollectionType.mcp}
              providerName={value.provider_name}
              providerShowName={value.provider_show_name}
              toolLabel={value.tool_label || value.tool_name}
              showSwitch={supportEnableSwitch}
              switchValue={value.enabled}
              onSwitchChange={handleEnabledChange}
              onDelete={onDelete}
              noAuth={currentProvider && currentTool && !currentProvider.is_team_authorization}
              uninstalled={!currentProvider && inMarketPlace}
              versionMismatch={currentProvider && inMarketPlace && !currentTool}
              installInfo={manifest?.latest_package_identifier}
              onInstall={() => handleInstall()}
              isError={(!currentProvider || !currentTool) && !inMarketPlace}
              errorTip={
                <div className='max-w-[240px] space-y-1 text-xs'>
                  <h3 className='font-semibold text-text-primary'>{currentTool ? t('plugin.detailPanel.toolSelector.uninstalledTitle') : t('plugin.detailPanel.toolSelector.unsupportedTitle')}</h3>
                  <p className='tracking-tight text-text-secondary'>{currentTool ? t('plugin.detailPanel.toolSelector.uninstalledContent') : t('plugin.detailPanel.toolSelector.unsupportedContent')}</p>
                  <p>
                    <Link href={'/plugins'} className='tracking-tight text-text-accent'>{t('plugin.detailPanel.toolSelector.uninstalledLink')}</Link>
                  </p>
                </div>
              }
              canChooseMCPTool={canChooseMCPTool}
            />
          )}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent>
          <div className={cn('relative max-h-[642px] min-h-20 w-[361px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm', 'overflow-y-auto pb-2')}>
            <>
              <div className='system-xl-semibold px-4 pb-1 pt-3.5 text-text-primary'>{t(`plugin.detailPanel.toolSelector.${isEdit ? 'toolSetting' : 'title'}`)}</div>
              {/* base form */}
              <div className='flex flex-col gap-3 px-4 py-2'>
                <div className='flex flex-col gap-1'>
                  <div className='system-sm-semibold flex h-6 items-center text-text-secondary'>{t('plugin.detailPanel.toolSelector.toolLabel')}</div>
                  <ToolPicker
                    placement='bottom'
                    offset={offset}
                    trigger={
                      <ToolTrigger
                        open={panelShowState || isShowChooseTool}
                        value={value}
                        provider={currentProvider}
                      />
                    }
                    isShow={panelShowState || isShowChooseTool}
                    onShowChange={trigger ? onPanelShowStateChange as any : setIsShowChooseTool}
                    disabled={false}
                    supportAddCustomTool
                    onSelect={handleSelectTool}
                    onSelectMultiple={handleSelectMultipleTool}
                    scope={scope}
                    selectedTools={selectedTools}
                    canChooseMCPTool={canChooseMCPTool}
                  />
                </div>
                <div className='flex flex-col gap-1'>
                  <div className='system-sm-semibold flex h-6 items-center text-text-secondary'>{t('plugin.detailPanel.toolSelector.descriptionLabel')}</div>
                  <Textarea
                    className='resize-none'
                    placeholder={t('plugin.detailPanel.toolSelector.descriptionPlaceholder')}
                    value={value?.extra?.description || ''}
                    onChange={handleDescriptionChange}
                    disabled={!value?.provider_name}
                  />
                </div>
              </div>
              {/* authorization */}
              {currentProvider && currentProvider.type === CollectionType.builtIn && currentProvider.allow_delete && (
                <>
                  <Divider className='my-1 w-full' />
                    <div className='px-4 py-2'>
                      <PluginAuthInAgent
                        pluginPayload={{
                          provider: currentProvider.name,
                          category: AuthCategory.tool,
                        }}
                        credentialId={value?.credential_id}
                        onAuthorizationItemClick={handleAuthorizationItemClick}
                      />
                  </div>
                </>
              )}
              {/* tool settings */}
              {(currentToolSettings.length > 0 || currentToolParams.length > 0) && currentProvider?.is_team_authorization && (
                <>
                  <Divider className='my-1 w-full' />
                  {/* tabs */}
                  {nodeId && showTabSlider && (
                    <TabSlider
                      className='mt-1 shrink-0 px-4'
                      itemClassName='py-3'
                      noBorderBottom
                      smallItem
                      value={currType}
                      onChange={(value) => {
                        setCurrType(value)
                      }}
                      options={[
                        { value: 'settings', text: t('plugin.detailPanel.toolSelector.settings')! },
                        { value: 'params', text: t('plugin.detailPanel.toolSelector.params')! },
                      ]}
                    />
                  )}
                  {nodeId && showTabSlider && currType === 'params' && (
                    <div className='px-4 py-2'>
                      <div className='system-xs-regular text-text-tertiary'>{t('plugin.detailPanel.toolSelector.paramsTip1')}</div>
                      <div className='system-xs-regular text-text-tertiary'>{t('plugin.detailPanel.toolSelector.paramsTip2')}</div>
                    </div>
                  )}
                  {/* user settings only */}
                  {userSettingsOnly && (
                    <div className='p-4 pb-1'>
                      <div className='system-sm-semibold-uppercase text-text-primary'>{t('plugin.detailPanel.toolSelector.settings')}</div>
                    </div>
                  )}
                  {/* reasoning config only */}
                  {nodeId && reasoningConfigOnly && (
                    <div className='mb-1 p-4 pb-1'>
                      <div className='system-sm-semibold-uppercase text-text-primary'>{t('plugin.detailPanel.toolSelector.params')}</div>
                      <div className='pb-1'>
                        <div className='system-xs-regular text-text-tertiary'>{t('plugin.detailPanel.toolSelector.paramsTip1')}</div>
                        <div className='system-xs-regular text-text-tertiary'>{t('plugin.detailPanel.toolSelector.paramsTip2')}</div>
                      </div>
                    </div>
                  )}
                  {/* user settings form */}
                  {(currType === 'settings' || userSettingsOnly) && (
                    <div className='px-4 py-2'>
                      <ToolForm
                        inPanel
                        readOnly={false}
                        nodeId={nodeId}
                        schema={settingsFormSchemas as any}
                        value={getPlainValue(value?.settings || {})}
                        onChange={handleSettingsFormChange}
                      />
                    </div>
                  )}
                  {/* reasoning config form */}
                  {nodeId && (currType === 'params' || reasoningConfigOnly) && (
                    <ReasoningConfigForm
                      value={value?.parameters || {}}
                      onChange={handleParamsFormChange}
                      schemas={paramsFormSchemas as any}
                      nodeOutputVars={nodeOutputVars}
                      availableNodes={availableNodes}
                      nodeId={nodeId}
                    />
                  )}
                </>
              )}
            </>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(ToolSelector)
