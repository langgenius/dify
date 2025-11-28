'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import copy from 'copy-to-clipboard'
import { produce } from 'immer'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiInformation2Line,
} from '@remixicon/react'
import { useFormattingChangedDispatcher } from '../../../debug/hooks'
import SettingBuiltInTool from './setting-built-in-tool'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import GroupAuthControl from './group-auth-control'
import ConfigContext from '@/context/debug-configuration'
import type { AgentTool } from '@/types/app'
import { type Collection, CollectionType } from '@/app/components/tools/types'
import { MAX_TOOLS_NUM } from '@/config'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import { canFindTool } from '@/utils'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMittContextSelector } from '@/context/mitt-context'

type AgentToolWithMoreInfo = (AgentTool & { icon: any; collection?: Collection; use_end_user_credentials?: boolean; end_user_credential_type?: string }) | null
const AgentTools: FC = () => {
  const { t } = useTranslation()
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const { modelConfig, setModelConfig } = useContext(ConfigContext)
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
  const getToolValue = (tool: ToolDefaultValue) => {
    return {
      provider_id: tool.provider_id,
      provider_type: tool.provider_type as CollectionType,
      provider_name: tool.provider_name,
      tool_name: tool.tool_name,
      tool_label: tool.tool_label,
      tool_parameters: tool.params,
      notAuthor: !tool.is_team_authorization,
      enabled: true,
      use_end_user_credentials: false,
      end_user_credential_type: '',
    } as any
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
    if(type === CollectionType.builtIn)
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

  const handleEndUserCredentialChange = useCallback((enabled: boolean) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === currentTool?.provider_id)
      if (tool)
        (tool as AgentTool).use_end_user_credentials = enabled
    })
    setCurrentTool({
      ...currentTool,
      use_end_user_credentials: enabled,
    } as any)
    setModelConfig(newModelConfig)
    formattingChangedDispatcher()
  }, [currentTool, modelConfig, setModelConfig, formattingChangedDispatcher])

  const handleEndUserCredentialTypeChange = useCallback((type: string) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === currentTool?.provider_id)
      if (tool)
        (tool as AgentTool).end_user_credential_type = type
    })
    setCurrentTool({
      ...currentTool,
      end_user_credential_type: type,
    } as any)
    setModelConfig(newModelConfig)
    formattingChangedDispatcher()
  }, [currentTool, modelConfig, setModelConfig, formattingChangedDispatcher])

  return (
    <>
      <Panel
        className={cn('mt-2', tools.length === 0 && 'pb-2')}
        noBodySpacing={tools.length === 0}
        title={
          <div className='flex items-center'>
            <div className='mr-1'>{t('appDebug.agent.tools.name')}</div>
            <Tooltip
              popupContent={
                <div className='w-[180px]'>
                  {t('appDebug.agent.tools.description')}
                </div>
              }
            />
          </div>
        }
        headerRight={
          <div className='flex items-center'>
            <div className='text-xs font-normal leading-[18px] text-text-tertiary'>{tools.filter(item => !!item.enabled).length}/{tools.length}&nbsp;{t('appDebug.agent.tools.enabled')}</div>
            {tools.length < MAX_TOOLS_NUM && (
              <>
                <div className='ml-3 mr-1 h-3.5 w-px bg-divider-regular'></div>
                <ToolPicker
                  trigger={<OperationBtn type="add" />}
                  isShow={isShowChooseTool}
                  onShowChange={setIsShowChooseTool}
                  disabled={false}
                  supportAddCustomTool
                  onSelect={handleSelectTool}
                  onSelectMultiple={handleSelectMultipleTool}
                  selectedTools={tools as unknown as ToolValue[]}
                  canChooseMCPTool
                />
              </>
            )}
          </div>
        }
      >
        <div className='space-y-2'>
          {Object.values(
            tools.reduce((acc, item, idx) => {
              const key = item.provider_id
              if (!acc[key]) {
                acc[key] = {
                  providerId: item.provider_id,
                  providerName: getProviderShowName(item) || '',
                  icon: item.icon,
                  providerType: item.provider_type,
                  tools: [] as (AgentTool & { __index: number })[],
                }
              }
              acc[key].tools.push({ ...item, __index: idx })
              return acc
            }, {} as Record<string, { providerId: string; providerName: string; providerType: CollectionType; icon: any; tools: (AgentTool & { __index: number })[] }>),
          ).map(group => (
            <div
              key={group.providerId}
              className='space-y-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-2 shadow-xs'
              onClickCapture={() => {
                // 调试：查看 provider 及其工具数据
                console.log('provider group', group)
              }}
            >
              <div className='flex items-center gap-2 px-1'>
                {typeof group.icon === 'string'
                  ? <div className='h-5 w-5 rounded-md bg-cover bg-center' style={{ backgroundImage: `url(${group.icon})` }} />
                  : <AppIcon className='rounded-md' size='xs' icon={group.icon?.content} background={group.icon?.background} />}
                <div className='system-sm-semibold text-text-secondary'>{group.providerName}</div>
                <div className='ml-auto'>
                  <GroupAuthControl
                    providerId={group.providerId}
                    providerName={group.providerName}
                    providerType={group.providerType}
                    credentialId={group.tools.find(t => !!t.credential_id)?.credential_id}
                    onChange={(id) => {
                      const newModelConfig = produce(modelConfig, (draft) => {
                        draft.agentConfig.tools.forEach((tool: any) => {
                          if (tool.provider_id === group.providerId)
                            tool.credential_id = id
                        })
                      })
                      setModelConfig(newModelConfig)
                      formattingChangedDispatcher()
                    }}
                  />
                </div>
                {group.tools.every(t => t.notAuthor) && (
                  <Button
                    variant='secondary'
                    size='small'
                    className='ml-2'
                    onClick={() => {
                      const first = group.tools[0]
                      setCurrentTool(first as any)
                      setIsShowSettingTool(true)
                    }}
                  >
                    {t('tools.notAuthorized')}
                    <Indicator className='ml-2' color='orange' />
                  </Button>
                )}
              </div>
              <div className='space-y-1'>
                {group.tools.map(item => (
                  <div
                    key={`${item.provider_id}-${item.tool_name}`}
                    className={cn(
                      'group relative flex w-full items-center justify-between rounded-lg pl-[21px] pr-2 hover:bg-state-base-hover',
                      isDeleting === item.__index && 'border border-state-destructive-border hover:bg-state-destructive-hover',
                    )}
                    onClickCapture={() => {
                      // 调试：查看工具行数据

                      console.log('tool item', item)
                    }}
                  >
                    <div className='flex w-0 grow items-center'>
                      <div
                        className={cn(
                          'system-xs-regular flex w-0 grow items-center truncate border-l-2 border-divider-subtle pl-4',
                          (item.isDeleted || item.notAuthor || !item.enabled) ? 'opacity-50' : '',
                        )}
                      >
                        <span className='system-xs-medium pr-1.5 text-text-secondary'>{item.tool_label}</span>
                        <span className='text-text-tertiary'>{item.tool_name}</span>
                        {!item.isDeleted && (
                          <Tooltip
                            popupContent={
                              <div className='w-[180px]'>
                                <div className='mb-1.5 text-text-secondary'>{item.tool_name}</div>
                                <div className='mb-1.5 text-text-tertiary'>{t('tools.toolNameUsageTip')}</div>
                                <div className='cursor-pointer text-text-accent' onClick={() => copy(item.tool_name)}>{t('tools.copyToolName')}</div>
                              </div>
                            }
                          >
                            <div className='h-4 w-4'>
                              <div className='ml-0.5 hidden group-hover:inline-block'>
                                <RiInformation2Line className='h-4 w-4 text-text-tertiary' />
                              </div>
                            </div>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    <div className='flex shrink-0 items-center space-x-2'>
                      {item.isDeleted && (
                        <div className='mr-2 flex items-center'>
                          <Tooltip
                            popupContent={t('tools.toolRemoved')}
                          >
                            <div className='mr-1 cursor-pointer rounded-md p-1 hover:bg-black/5'>
                              <AlertTriangle className='h-4 w-4 text-[#F79009]' />
                            </div>
                          </Tooltip>
                          <div
                            className='cursor-pointer rounded-md p-1 text-text-tertiary hover:text-text-destructive'
                            onClick={() => {
                              const newModelConfig = produce(modelConfig, (draft) => {
                                draft.agentConfig.tools.splice(item.__index, 1)
                              })
                              setModelConfig(newModelConfig)
                              formattingChangedDispatcher()
                            }}
                            onMouseOver={() => setIsDeleting(item.__index)}
                            onMouseLeave={() => setIsDeleting(-1)}
                          >
                            <RiDeleteBinLine className='h-4 w-4' />
                          </div>
                        </div>
                      )}
                      {!item.isDeleted && (
                        <div className='pointer-events-none mr-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100'>
                          {!item.notAuthor && (
                            <Tooltip
                              popupContent={t('tools.setBuiltInTools.infoAndSetting')}
                            >
                              <div className='cursor-pointer rounded-md p-1 hover:bg-black/5' onClick={() => {
                                setCurrentTool(item as any)
                                setIsShowSettingTool(true)
                              }}>
                                <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
                              </div>
                            </Tooltip>
                          )}
                          <div
                            className='cursor-pointer rounded-md p-1 text-text-tertiary hover:text-text-destructive'
                            onClick={() => {
                              const newModelConfig = produce(modelConfig, (draft) => {
                                draft.agentConfig.tools.splice(item.__index, 1)
                              })
                              setModelConfig(newModelConfig)
                              formattingChangedDispatcher()
                            }}
                            onMouseOver={() => setIsDeleting(item.__index)}
                            onMouseLeave={() => setIsDeleting(-1)}
                          >
                            <RiDeleteBinLine className='h-4 w-4' />
                          </div>
                        </div>
                      )}
                      <div className={cn(item.isDeleted && 'opacity-50')}>
                        {!item.notAuthor && (
                          <Switch
                            defaultValue={item.isDeleted ? false : item.enabled}
                            disabled={item.isDeleted}
                            size='md'
                            onChange={(enabled) => {
                              const newModelConfig = produce(modelConfig, (draft) => {
                                (draft.agentConfig.tools[item.__index] as any).enabled = enabled
                              })
                              setModelConfig(newModelConfig)
                              formattingChangedDispatcher()
                            }} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel >
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
          useEndUserCredentialEnabled={currentTool?.use_end_user_credentials}
          endUserCredentialType={currentTool?.end_user_credential_type}
          onEndUserCredentialChange={handleEndUserCredentialChange}
          onEndUserCredentialTypeChange={handleEndUserCredentialTypeChange}
        />
      )}
    </>
  )
}
export default React.memo(AgentTools)
