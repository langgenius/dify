'use client'
import type { FC } from 'react'
import type { Collection } from '@/app/components/tools/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentTool } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiInformation2Line,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import AppIcon from '@/app/components/base/app-icon'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Indicator from '@/app/components/header/indicator'
import { CollectionType } from '@/app/components/tools/types'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { MAX_TOOLS_NUM } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { useMittContextSelector } from '@/context/mitt-context'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import { canFindTool } from '@/utils'
import { useFormattingChangedDispatcher } from '../../../debug/hooks'
import SettingBuiltInTool from './setting-built-in-tool'

type AgentToolWithMoreInfo = AgentTool & { icon: any, collection?: Collection } | null
const AgentTools: FC = () => {
  const { t } = useTranslation()
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const { readonly, modelConfig, setModelConfig } = useContext(ConfigContext)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const collectionList = useMemo(() => {
    const allTools = [
      ...(buildInTools || []),
      ...(customTools || []),
      ...(workflowTools || []),
      ...(mcpTools || []),
    ]
    return allTools
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const formattingChangedDispatcher = useFormattingChangedDispatcher()
  const [currentTool, setCurrentTool] = useState<AgentToolWithMoreInfo>(null)
  const [isShowSettingTool, setIsShowSettingTool] = useState(false)
  const tools = (modelConfig?.agentConfig?.tools as AgentTool[] || []).map((item) => {
    const collection = collectionList.find(
      collection =>
        canFindTool(collection.id, item.provider_id)
        && collection.type === item.provider_type,
    )
    const icon = collection?.icon
    return {
      ...item,
      icon,
      collection,
    }
  })
  const useSubscribe = useMittContextSelector(s => s.useSubscribe)
  const handleUpdateToolsWhenInstallToolSuccess = useCallback((installedPluginNames: string[]) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.agentConfig.tools.forEach((item: any) => {
        if (item.isDeleted && installedPluginNames.includes(item.provider_id))
          item.isDeleted = false
      })
    })
    setModelConfig(newModelConfig)
  }, [modelConfig, setModelConfig])
  useSubscribe('plugin:install:success', handleUpdateToolsWhenInstallToolSuccess as any)

  const handleToolSettingChange = (value: Record<string, any>) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === currentTool?.collection?.id && item.tool_name === currentTool?.tool_name)
      if (tool)
        (tool as AgentTool).tool_parameters = value
    })
    setModelConfig(newModelConfig)
    setIsShowSettingTool(false)
    formattingChangedDispatcher()
  }

  const [isDeleting, setIsDeleting] = useState<number>(-1)
  const getDeleteToolLabel = (tool: AgentTool) => `${t('operation.delete', { ns: 'common' })} ${tool.tool_label || tool.tool_name}`
  const getToolValue = (tool: ToolDefaultValue) => {
    const currToolInCollections = collectionList.find(c => c.id === tool.provider_id)
    const currToolWithConfigs = currToolInCollections?.tools.find(t => t.name === tool.tool_name)
    const formSchemas = currToolWithConfigs ? toolParametersToFormSchemas(currToolWithConfigs.parameters) : []
    const paramsWithDefaultValue = addDefaultValue(tool.params, formSchemas)
    return {
      provider_id: tool.provider_id,
      provider_type: tool.provider_type as CollectionType,
      provider_name: tool.provider_name,
      tool_name: tool.tool_name,
      tool_label: tool.tool_label,
      tool_parameters: paramsWithDefaultValue,
      notAuthor: !tool.is_team_authorization,
      enabled: true,
      type: tool.provider_type as CollectionType,
    }
  }
  const handleSelectTool = (tool: ToolDefaultValue) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.agentConfig.tools.push(getToolValue(tool))
    })
    setModelConfig(newModelConfig)
  }

  const handleSelectMultipleTool = (tool: ToolDefaultValue[]) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.agentConfig.tools.push(...tool.map(getToolValue))
    })
    setModelConfig(newModelConfig)
  }
  const getProviderShowName = (item: AgentTool) => {
    const type = item.provider_type
    if (type === CollectionType.builtIn)
      return item.provider_name.split('/').pop()
    return item.provider_name
  }

  const handleAuthorizationItemClick = useCallback((credentialId: string) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === currentTool?.provider_id)
      if (tool)
        (tool as AgentTool).credential_id = credentialId
    })
    setCurrentTool({
      ...currentTool,
      credential_id: credentialId,
    } as any)
    setModelConfig(newModelConfig)
    formattingChangedDispatcher()
  }, [currentTool, modelConfig, setModelConfig, formattingChangedDispatcher])

  return (
    <>
      <Panel
        className={cn('mt-2', tools.length === 0 && 'pb-2')}
        noBodySpacing={tools.length === 0}
        title={(
          <div className="flex items-center">
            <div className="mr-1">{t('agent.tools.name', { ns: 'appDebug' })}</div>
            <Popover>
              <PopoverTrigger
                openOnHover
                aria-label={t('agent.tools.description', { ns: 'appDebug' })}
                render={(
                  <button
                    type="button"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm p-px outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                  >
                    <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                  </button>
                )}
              />
              <PopoverContent popupClassName="w-[180px] px-3 py-2 system-xs-regular text-text-tertiary">
                {t('agent.tools.description', { ns: 'appDebug' })}
              </PopoverContent>
            </Popover>
          </div>
        )}
        headerRight={(
          <div className="flex items-center">
            <div className="text-xs leading-[18px] font-normal text-text-tertiary">
              {tools.filter(item => !!item.enabled).length}
              /
              {tools.length}
              &nbsp;
              {t('agent.tools.enabled', { ns: 'appDebug' })}
            </div>
            {tools.length < MAX_TOOLS_NUM && !readonly && (
              <>
                <div className="mr-1 ml-3 h-3.5 w-px bg-divider-regular"></div>
                <ToolPicker
                  trigger={<OperationBtn type="add" />}
                  isShow={isShowChooseTool}
                  onShowChange={setIsShowChooseTool}
                  disabled={false}
                  supportAddCustomTool
                  onSelect={handleSelectTool}
                  onSelectMultiple={handleSelectMultipleTool}
                  selectedTools={tools as unknown as ToolValue[]}
                />
              </>
            )}
          </div>
        )}
      >
        <div className={cn('grid grid-cols-1 items-center gap-1 2xl:grid-cols-2', readonly && 'cursor-not-allowed grid-cols-2')}>
          {tools.map((item: AgentTool & { icon: any, collection?: Collection }, index) => (
            <div
              key={index}
              className={cn(
                'cursor group relative flex w-full items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-1.5 pr-2 shadow-xs last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                isDeleting === index && 'border-state-destructive-border hover:bg-state-destructive-hover',
              )}
            >
              <div className="flex w-0 grow items-center">
                {item.isDeleted && <DefaultToolIcon className="h-5 w-5" />}
                {!item.isDeleted && (
                  <div className={cn((item.notAuthor || !item.enabled) && 'shrink-0 opacity-50')}>
                    {typeof item.icon === 'string' && <div className="h-5 w-5 rounded-md bg-cover bg-center" style={{ backgroundImage: `url(${item.icon})` }} />}
                    {typeof item.icon !== 'string' && <AppIcon className="rounded-md" size="xs" icon={item.icon?.content} background={item.icon?.background} />}
                  </div>
                )}
                <div
                  className={cn(
                    'ml-1.5 flex w-0 grow items-center truncate system-xs-regular',
                    (item.isDeleted || item.notAuthor || !item.enabled) ? 'opacity-50' : '',
                  )}
                >
                  <span className="pr-1.5 system-xs-medium text-text-secondary">{getProviderShowName(item)}</span>
                  <span className="text-text-tertiary">{item.tool_label}</span>
                  {!item.isDeleted && !readonly && (
                    <Popover>
                      <span className="h-4 w-4">
                        <PopoverTrigger
                          openOnHover
                          aria-label={item.tool_name}
                          render={(
                            <button
                              type="button"
                              className="ml-0.5 hidden h-4 w-4 items-center justify-center rounded-sm outline-hidden group-hover:inline-flex hover:bg-state-base-hover focus-visible:inline-flex focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                              data-testid="tool-info-tooltip"
                            >
                              <RiInformation2Line className="h-4 w-4 text-text-tertiary" />
                            </button>
                          )}
                        />
                      </span>
                      <PopoverContent popupClassName="w-[180px] px-3 py-2 system-xs-regular">
                        <div className="w-[180px]">
                          <div className="mb-1.5 text-text-secondary">{item.tool_name}</div>
                          <div className="mb-1.5 text-text-tertiary">{t('toolNameUsageTip', { ns: 'tools' })}</div>
                          <button
                            type="button"
                            className="cursor-pointer rounded-sm border-none bg-transparent p-0 text-left text-text-accent outline-hidden hover:underline focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                            onClick={() => copy(item.tool_name)}
                          >
                            {t('copyToolName', { ns: 'tools' })}
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              <div className="ml-1 flex shrink-0 items-center">
                {item.isDeleted && (
                  <div className="mr-2 flex items-center">
                    <Popover>
                      <PopoverTrigger
                        openOnHover
                        aria-label={t('toolRemoved', { ns: 'tools' })}
                        render={(
                          <button
                            type="button"
                            className="mr-1 cursor-pointer rounded-md p-1 outline-hidden hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                          >
                            <AlertTriangle className="h-4 w-4 text-[#F79009]" />
                          </button>
                        )}
                      />
                      <PopoverContent popupClassName="px-3 py-2 system-xs-regular text-text-tertiary">
                        {t('toolRemoved', { ns: 'tools' })}
                      </PopoverContent>
                    </Popover>
                    <button
                      type="button"
                      aria-label={getDeleteToolLabel(item)}
                      className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-tertiary outline-hidden hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                      onClick={() => {
                        const newModelConfig = produce(modelConfig, (draft) => {
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}
                      onMouseOver={() => setIsDeleting(index)}
                      onMouseLeave={() => setIsDeleting(-1)}
                    >
                      <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {!item.isDeleted && !readonly && (
                  <div className="mr-2 hidden items-center gap-1 group-hover:flex">
                    {!item.notAuthor && (
                      <Tooltip>
                        <TooltipTrigger
                          render={(
                            <button
                              type="button"
                              className="cursor-pointer rounded-md p-1 outline-hidden hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                              aria-label={t('setBuiltInTools.infoAndSetting', { ns: 'tools' })}
                              onClick={() => {
                                setCurrentTool(item)
                                setIsShowSettingTool(true)
                              }}
                            >
                              <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                            </button>
                          )}
                        />
                        <TooltipContent>
                          {t('setBuiltInTools.infoAndSetting', { ns: 'tools' })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <button
                      type="button"
                      aria-label={getDeleteToolLabel(item)}
                      className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-tertiary outline-hidden hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                      onClick={() => {
                        const newModelConfig = produce(modelConfig, (draft) => {
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}
                      onMouseOver={() => setIsDeleting(index)}
                      onMouseLeave={() => setIsDeleting(-1)}
                    >
                      <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                <div className={cn(item.isDeleted && 'opacity-50')}>
                  {!item.notAuthor && (
                    <Switch
                      checked={item.isDeleted ? false : item.enabled}
                      disabled={item.isDeleted || readonly}
                      size="md"
                      onCheckedChange={(enabled) => {
                        const newModelConfig = produce(modelConfig, (draft) => {
                          (draft.agentConfig.tools[index] as any).enabled = enabled
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}
                    />
                  )}
                  {item.notAuthor && (
                    <Button
                      variant="secondary"
                      disabled={readonly}
                      size="small"
                      onClick={() => {
                        setCurrentTool(item)
                        setIsShowSettingTool(true)
                      }}
                    >
                      {t('notAuthorized', { ns: 'tools' })}
                      <Indicator className="ml-2" color="orange" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      {isShowSettingTool && (
        <SettingBuiltInTool
          toolName={currentTool?.tool_name as string}
          setting={currentTool?.tool_parameters}
          collection={currentTool?.collection as ToolWithProvider}
          isModel={currentTool?.collection?.type === CollectionType.model}
          onSave={handleToolSettingChange}
          onHide={() => setIsShowSettingTool(false)}
          credentialId={currentTool?.credential_id}
          onAuthorizationItemClick={handleAuthorizationItemClick}
        />
      )}
    </>
  )
}
export default React.memo(AgentTools)
