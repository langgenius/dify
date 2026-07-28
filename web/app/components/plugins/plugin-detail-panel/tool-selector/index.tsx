'use client'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { ReactElement, Ref } from 'react'
import type { Node } from 'reactflow'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { CollectionType } from '@/app/components/tools/types'
import Link from '@/next/link'
import { ToolAuthorizationSection } from './components/tool-authorization-section'
import { ToolBaseForm } from './components/tool-base-form'
import { ToolItem } from './components/tool-item'
import { ToolSettingsPanel } from './components/tool-settings-panel'
import { ToolTrigger } from './components/tool-trigger'
import { useToolSelector } from './hooks/use-tool-selector'

type TriggerProps =
  | {
      trigger: ReactElement
      triggerRef?: never
      controlledState: boolean
      onControlledStateChange: (state: boolean) => void
    }
  | {
      trigger?: never
      triggerRef?: Ref<HTMLButtonElement>
      controlledState?: never
      onControlledStateChange?: never
    }

type Props = Readonly<{
  disabled?: boolean
  placement?: Placement
  scope?: string
  value?: ToolValue
  selectedTools?: ToolValue[]
  onSelect: (tool: ToolValue) => void
  onSelectMultiple?: (tool: ToolValue[]) => void
  isEdit?: boolean
  onDelete?: () => void
  supportEnableSwitch?: boolean
  panelShowState?: boolean
  onPanelShowStateChange?: (state: boolean) => void
  nodeOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  nodeId?: string
}> &
  TriggerProps

function ToolSelector({
  value,
  selectedTools,
  isEdit,
  disabled,
  placement = 'left',
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
  triggerRef,
}: Props) {
  const { t } = useTranslation()
  const {
    isShow,
    setIsShow,
    isShowChooseTool,
    setIsShowChooseTool,
    currType,
    setCurrType,
    currentProvider,
    currentTool,
    settingsFormSchemas,
    paramsFormSchemas,
    showTabSlider,
    userSettingsOnly,
    reasoningConfigOnly,
    manifestIcon,
    inMarketPlace,
    manifest,
    handleSelectTool,
    handleSelectMultipleTool,
    handleDescriptionChange,
    handleSettingsFormChange,
    handleParamsFormChange,
    handleEnabledChange,
    handleAuthorizationItemClick,
    handleInstall,
    settingsValue,
  } = useToolSelector({ value, onSelect, onSelectMultiple })

  const portalOpen = trigger ? controlledState : isShow
  const onPortalOpenChange = trigger ? onControlledStateChange : setIsShow
  const handlePortalOpenChange = (nextOpen: boolean) => {
    const isConfiguredToolUnavailable = !!value?.provider_name && (!currentProvider || !currentTool)
    if (nextOpen && (disabled || isConfiguredToolUnavailable)) return
    onPortalOpenChange?.(nextOpen)
  }

  const renderErrorTip = () => (
    <div className="max-w-[240px] space-y-1 text-xs">
      <h3 className="font-semibold text-text-primary">
        {currentTool
          ? t(($) => $['detailPanel.toolSelector.uninstalledTitle'], { ns: 'plugin' })
          : t(($) => $['detailPanel.toolSelector.unsupportedTitle'], { ns: 'plugin' })}
      </h3>
      <p className="tracking-tight text-text-secondary">
        {currentTool
          ? t(($) => $['detailPanel.toolSelector.uninstalledContent'], { ns: 'plugin' })
          : t(($) => $['detailPanel.toolSelector.unsupportedContent'], { ns: 'plugin' })}
      </p>
      <p>
        <Link href="/plugins" className="tracking-tight text-text-accent">
          {t(($) => $['detailPanel.toolSelector.uninstalledLink'], { ns: 'plugin' })}
        </Link>
      </p>
    </div>
  )

  return (
    <Popover open={portalOpen} onOpenChange={handlePortalOpenChange}>
      {trigger ? <PopoverTrigger render={trigger} /> : null}

      {!trigger && !value?.provider_name ? (
        <PopoverTrigger
          render={
            <ToolTrigger
              ref={triggerRef}
              isConfigure
              open={isShow}
              value={value}
              provider={currentProvider}
            />
          }
        />
      ) : null}

      {!trigger && value?.provider_name ? (
        <ToolItem
          triggerRef={triggerRef}
          triggerLabel={value.tool_label || value.tool_name}
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
          onInstall={handleInstall}
          isError={(!currentProvider || !currentTool) && !inMarketPlace}
          errorTip={renderErrorTip()}
        />
      ) : null}

      <PopoverContent
        placement={placement}
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div
          className={cn(
            'relative max-h-[642px] min-h-20 w-[361px] rounded-xl',
            'border-[0.5px] border-components-panel-border bg-components-panel-bg-blur',
            'overflow-y-auto pb-4 shadow-lg backdrop-blur-xs',
          )}
        >
          <div className="px-4 pt-3.5 pb-1 system-xl-semibold text-text-primary">
            {t(($) => $[`detailPanel.toolSelector.${isEdit ? 'toolSetting' : 'title'}`], {
              ns: 'plugin',
            })}
          </div>

          <ToolBaseForm
            value={value}
            currentProvider={currentProvider}
            scope={scope}
            selectedTools={selectedTools}
            isShowChooseTool={isShowChooseTool}
            panelShowState={panelShowState}
            hasTrigger={!!trigger}
            onShowChange={setIsShowChooseTool}
            onPanelShowStateChange={onPanelShowStateChange}
            onSelectTool={handleSelectTool}
            onSelectMultipleTool={handleSelectMultipleTool}
            onDescriptionChange={handleDescriptionChange}
          />

          <ToolAuthorizationSection
            currentProvider={currentProvider}
            credentialId={value?.credential_id}
            onAuthorizationItemClick={handleAuthorizationItemClick}
          />

          <ToolSettingsPanel
            value={value}
            currentProvider={currentProvider}
            nodeId={nodeId}
            currType={currType}
            settingsFormSchemas={settingsFormSchemas}
            paramsFormSchemas={paramsFormSchemas}
            settingsValue={settingsValue}
            showTabSlider={showTabSlider}
            userSettingsOnly={userSettingsOnly}
            reasoningConfigOnly={reasoningConfigOnly}
            nodeOutputVars={nodeOutputVars}
            availableNodes={availableNodes}
            onCurrTypeChange={setCurrType}
            onSettingsFormChange={handleSettingsFormChange}
            onParamsFormChange={handleParamsFormChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(ToolSelector)
