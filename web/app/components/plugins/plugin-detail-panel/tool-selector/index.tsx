'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import {
  RiArrowLeftLine,
  RiArrowRightUpLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ToolTrigger from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-trigger'
import ToolItem from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-item'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import ToolCredentialForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-credentials-form'
import Toast from '@/app/components/base/toast'
import Textarea from '@/app/components/base/textarea'
import Divider from '@/app/components/base/divider'
import TabSlider from '@/app/components/base/tab-slider-plain'
import ReasoningConfigForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { generateFormValue, getPlainValue, getStructureValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

import { useAppContext } from '@/context/app-context'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
  useUpdateProviderCredentials,
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

type Props = {
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  scope?: string
  value?: ToolValue
  selectedTools?: ToolValue[]
  onSelect: (tool: {
    provider_name: string
    tool_name: string
    tool_label: string
    settings?: Record<string, any>
    parameters?: Record<string, any>
    extra?: Record<string, any>
  }) => void
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
}
const ToolSelector: FC<Props> = ({
  value,
  selectedTools,
  disabled,
  placement = 'left',
  offset = 4,
  onSelect,
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
  const [isShow, onShowChange] = useState(false)
  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const invalidateAllBuiltinTools = useInvalidateAllBuiltInTools()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  // plugin info check
  const { inMarketPlace, manifest } = usePluginInstalledCheck(value?.provider_name)

  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.id === value?.provider_name
    })
  }, [value, buildInTools, customTools, workflowTools])

  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const handleSelectTool = (tool: ToolDefaultValue) => {
    const settingValues = generateFormValue(tool.params, toolParametersToFormSchemas(tool.paramSchemas.filter(param => param.form !== 'llm') as any))
    const paramValues = generateFormValue(tool.params, toolParametersToFormSchemas(tool.paramSchemas.filter(param => param.form === 'llm') as any), true)
    const toolValue = {
      provider_name: tool.provider_id,
      type: tool.provider_type,
      tool_name: tool.tool_name,
      tool_label: tool.tool_label,
      settings: settingValues,
      parameters: paramValues,
      enabled: tool.is_team_authorization,
      extra: {
        description: '',
      },
      schemas: tool.paramSchemas,
    }
    onSelect(toolValue)
    // setIsShowChooseTool(false)
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

  // authorization
  const { isCurrentWorkspaceManager } = useAppContext()
  const [isShowSettingAuth, setShowSettingAuth] = useState(false)
  const handleCredentialSettingUpdate = () => {
    invalidateAllBuiltinTools()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setShowSettingAuth(false)
    onShowChange(false)
  }

  const { mutate: updatePermission } = useUpdateProviderCredentials({
    onSuccess: handleCredentialSettingUpdate,
  })

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
              providerName={value.provider_name}
              toolLabel={value.tool_label || value.tool_name}
              showSwitch={supportEnableSwitch}
              switchValue={value.enabled}
              onSwitchChange={handleEnabledChange}
              onDelete={onDelete}
              noAuth={currentProvider && currentTool && !currentProvider.is_team_authorization}
              onAuth={() => setShowSettingAuth(true)}
              uninstalled={!currentProvider && inMarketPlace}
              versionMismatch={currentProvider && inMarketPlace && !currentTool}
              installInfo={manifest?.latest_package_identifier}
              onInstall={() => handleInstall()}
              isError={(!currentProvider || !currentTool) && !inMarketPlace}
              errorTip={
                <div className='max-w-[240px] space-y-1 text-xs'>
                  <h3 className='text-text-primary font-semibold'>{currentTool ? t('plugin.detailPanel.toolSelector.uninstalledTitle') : t('plugin.detailPanel.toolSelector.unsupportedTitle')}</h3>
                  <p className='text-text-secondary tracking-tight'>{currentTool ? t('plugin.detailPanel.toolSelector.uninstalledContent') : t('plugin.detailPanel.toolSelector.unsupportedContent')}</p>
                  <p>
                    <Link href={'/plugins'} className='text-text-accent tracking-tight'>{t('plugin.detailPanel.toolSelector.uninstalledLink')}</Link>
                  </p>
                </div>
              }
            />
          )}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className={cn('border-components-panel-border bg-components-panel-bg-blur relative max-h-[642px] min-h-20 w-[361px] rounded-xl border-[0.5px] pb-4 shadow-lg backdrop-blur-sm', !isShowSettingAuth && 'overflow-y-auto pb-2')}>
            {!isShowSettingAuth && (
              <>
                <div className='system-xl-semibold text-text-primary px-4 pb-1 pt-3.5'>{t('plugin.detailPanel.toolSelector.title')}</div>
                {/* base form */}
                <div className='flex flex-col gap-3 px-4 py-2'>
                  <div className='flex flex-col gap-1'>
                    <div className='system-sm-semibold text-text-secondary flex h-6 items-center'>{t('plugin.detailPanel.toolSelector.toolLabel')}</div>
                    <ToolPicker
                      panelClassName='w-[328px]'
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
                      scope={scope}
                      selectedTools={selectedTools}
                    />
                  </div>
                  <div className='flex flex-col gap-1'>
                    <div className='system-sm-semibold text-text-secondary flex h-6 items-center'>{t('plugin.detailPanel.toolSelector.descriptionLabel')}</div>
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
                      {!currentProvider.is_team_authorization && (
                        <Button
                          variant='primary'
                          className={cn('w-full shrink-0')}
                          onClick={() => setShowSettingAuth(true)}
                          disabled={!isCurrentWorkspaceManager}
                        >
                          {t('tools.auth.unauthorized')}
                        </Button>
                      )}
                      {currentProvider.is_team_authorization && (
                        <Button
                          variant='secondary'
                          className={cn('w-full shrink-0')}
                          onClick={() => setShowSettingAuth(true)}
                          disabled={!isCurrentWorkspaceManager}
                        >
                          <Indicator className='mr-2' color={'green'} />
                          {t('tools.auth.authorized')}
                        </Button>
                      )}
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
                        <Form
                          value={getPlainValue(value?.settings || {})}
                          onChange={handleSettingsFormChange}
                          formSchemas={settingsFormSchemas as any}
                          isEditMode={true}
                          showOnVariableMap={{}}
                          validating={false}
                          inputClassName='bg-components-input-bg-normal hover:bg-components-input-bg-hover'
                          fieldMoreInfo={item => item.url
                            ? (<a
                              href={item.url}
                              target='_blank' rel='noopener noreferrer'
                              className='text-text-accent inline-flex items-center text-xs'
                            >
                              {t('tools.howToGet')}
                              <RiArrowRightUpLine className='ml-1 h-3 w-3' />
                            </a>)
                            : null}
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
            )}
            {/* authorization panel */}
            {isShowSettingAuth && currentProvider && (
              <>
                <div className='relative flex flex-col gap-1 pt-3.5'>
                  <div className='border-components-panel-border bg-components-panel-bg-blur absolute -top-2 left-2 w-[345px] rounded-t-xl border-[0.5px] pt-2 backdrop-blur-sm'></div>
                  <div
                    className='system-xs-semibold-uppercase text-text-accent-secondary flex h-6 cursor-pointer items-center gap-1 px-3'
                    onClick={() => setShowSettingAuth(false)}
                  >
                    <RiArrowLeftLine className='h-4 w-4' />
                    BACK
                  </div>
                  <div className='system-xl-semibold text-text-primary px-4'>{t('tools.auth.setupModalTitle')}</div>
                  <div className='system-xs-regular text-text-tertiary px-4'>{t('tools.auth.setupModalTitleDescription')}</div>
                </div>
                <ToolCredentialForm
                  collection={currentProvider}
                  onCancel={() => setShowSettingAuth(false)}
                  onSaved={async value => updatePermission({
                    providerName: currentProvider.name,
                    credentials: value,
                  })}
                />
              </>
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(ToolSelector)
