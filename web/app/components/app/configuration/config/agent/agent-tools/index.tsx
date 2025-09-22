'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import copy from 'copy-to-clipboard'
import produce from 'immer'
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
import ConfigContext from '@/context/debug-configuration'
import type { AgentTool } from '@/types/app'
import { type Collection, CollectionType } from '@/app/components/tools/types'
import { MAX_TOOLS_NUM } from '@/config'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import cn from '@/utils/classnames'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import { canFindTool } from '@/utils'
import { useAllBuiltInTools, useAllCustomTools, useAllMCPTools, useAllWorkflowTools } from '@/service/use-tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMittContextSelector } from '@/context/mitt-context'

type AgentToolWithMoreInfo = AgentTool & { icon: any; collection?: Collection } | null
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
        <div className='grid grid-cols-1 flex-wrap items-center justify-between gap-1 2xl:grid-cols-2'>
          {tools.map((item: AgentTool & { icon: any; collection?: Collection }, index) => (
            <div key={index}
              className={cn(
                'cursor group relative flex w-full items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-1.5 pr-2 shadow-xs last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                isDeleting === index && 'border-state-destructive-border hover:bg-state-destructive-hover',
              )}
            >
              <div className='flex w-0 grow items-center'>
                {item.isDeleted && <DefaultToolIcon className='h-5 w-5' />}
                {!item.isDeleted && (
                  <div className={cn((item.notAuthor || !item.enabled) && 'shrink-0 opacity-50')}>
                    {typeof item.icon === 'string' && <div className='h-5 w-5 rounded-md bg-cover bg-center' style={{ backgroundImage: `url(${item.icon})` }} />}
                    {typeof item.icon !== 'string' && <AppIcon className='rounded-md' size='xs' icon={item.icon?.content} background={item.icon?.background} />}
                  </div>
                )}
                <div
                  className={cn(
                    'system-xs-regular ml-1.5 flex w-0 grow items-center truncate',
                    (item.isDeleted || item.notAuthor || !item.enabled) ? 'opacity-50' : '',
                  )}
                >
                  <span className='system-xs-medium pr-1.5 text-text-secondary'>{getProviderShowName(item)}</span>
                  <span className='text-text-tertiary'>{item.tool_label}</span>
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
              <div className='ml-1 flex shrink-0 items-center'>
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
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}
                      onMouseOver={() => setIsDeleting(index)}
                      onMouseLeave={() => setIsDeleting(-1)}
                    >
                      <RiDeleteBinLine className='h-4 w-4' />
                    </div>
                  </div>
                )}
                {!item.isDeleted && (
                  <div className='mr-2 hidden items-center gap-1 group-hover:flex'>
                    {!item.notAuthor && (
                      <Tooltip
                        popupContent={t('tools.setBuiltInTools.infoAndSetting')}
                      >
                        <div className='cursor-pointer rounded-md p-1  hover:bg-black/5' onClick={() => {
                          setCurrentTool(item)
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
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}
                      onMouseOver={() => setIsDeleting(index)}
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
                          (draft.agentConfig.tools[index] as any).enabled = enabled
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }} />
                  )}
                  {item.notAuthor && (
                    <Button variant='secondary' size='small' onClick={() => {
                      setCurrentTool(item)
                      setIsShowSettingTool(true)
                    }}>
                      {t('tools.notAuthorized')}
                      <Indicator className='ml-2' color='orange' />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div >
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
        />
      )}
    </>
  )
}
export default React.memo(AgentTools)
