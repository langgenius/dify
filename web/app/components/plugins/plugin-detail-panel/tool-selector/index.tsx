'use client'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { FC } from 'react'
import type { Node } from 'reactflow'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import Link from 'next/link'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { CollectionType } from '@/app/components/tools/types'
import { cn } from '@/utils/classnames'
import {
  ToolAuthorizationSection,
  ToolBaseForm,
  ToolItem,
  ToolSettingsPanel,
  ToolTrigger,
} from './components'
import { useToolSelectorState } from './hooks/use-tool-selector-state'

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
  nodeOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  nodeId?: string
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
}) => {
  const { t } = useTranslation()

  // Use custom hook for state management
  const state = useToolSelectorState({ value, onSelect, onSelectMultiple })
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
    getSettingsValue,
  } = state

  const handleTriggerClick = () => {
    if (disabled)
      return
    setIsShow(true)
  }

  // Determine portal open state based on controlled vs uncontrolled mode
  const portalOpen = trigger ? controlledState : isShow
  const onPortalOpenChange = trigger ? onControlledStateChange : setIsShow

  // Build error tooltip content
  const renderErrorTip = () => (
    <div className="max-w-[240px] space-y-1 text-xs">
      <h3 className="font-semibold text-text-primary">
        {currentTool
          ? t('detailPanel.toolSelector.uninstalledTitle', { ns: 'plugin' })
          : t('detailPanel.toolSelector.unsupportedTitle', { ns: 'plugin' })}
      </h3>
      <p className="tracking-tight text-text-secondary">
        {currentTool
          ? t('detailPanel.toolSelector.uninstalledContent', { ns: 'plugin' })
          : t('detailPanel.toolSelector.unsupportedContent', { ns: 'plugin' })}
      </p>
      <p>
        <Link href="/plugins" className="tracking-tight text-text-accent">
          {t('detailPanel.toolSelector.uninstalledLink', { ns: 'plugin' })}
        </Link>
      </p>
    </div>
  )

  return (
    <PortalToFollowElem
      placement={placement}
      offset={offset}
      open={portalOpen}
      onOpenChange={onPortalOpenChange}
    >
      <PortalToFollowElemTrigger
        className="w-full"
        onClick={() => {
          if (!currentProvider || !currentTool)
            return
          handleTriggerClick()
        }}
      >
        {trigger}

        {/* Default trigger - no value */}
        {!trigger && !value?.provider_name && (
          <ToolTrigger
            isConfigure
            open={isShow}
            value={value}
            provider={currentProvider}
          />
        )}

        {/* Default trigger - with value */}
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
            onInstall={handleInstall}
            isError={(!currentProvider || !currentTool) && !inMarketPlace}
            errorTip={renderErrorTip()}
          />
        )}
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className="z-10">
        <div className={cn(
          'relative max-h-[642px] min-h-20 w-[361px] rounded-xl',
          'border-[0.5px] border-components-panel-border bg-components-panel-bg-blur',
          'overflow-y-auto pb-2 pb-4 shadow-lg backdrop-blur-sm',
        )}
        >
          {/* Header */}
          <div className="system-xl-semibold px-4 pb-1 pt-3.5 text-text-primary">
            {t(`detailPanel.toolSelector.${isEdit ? 'toolSetting' : 'title'}`, { ns: 'plugin' })}
          </div>

          {/* Base form: tool picker + description */}
          <ToolBaseForm
            value={value}
            currentProvider={currentProvider}
            offset={offset}
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

          {/* Authorization section */}
          <ToolAuthorizationSection
            currentProvider={currentProvider}
            credentialId={value?.credential_id}
            onAuthorizationItemClick={handleAuthorizationItemClick}
          />

          {/* Settings panel */}
          <ToolSettingsPanel
            value={value}
            currentProvider={currentProvider}
            nodeId={nodeId}
            currType={currType}
            settingsFormSchemas={settingsFormSchemas}
            paramsFormSchemas={paramsFormSchemas}
            settingsValue={getSettingsValue()}
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
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(ToolSelector)
