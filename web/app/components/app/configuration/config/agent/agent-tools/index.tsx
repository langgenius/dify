'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
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
import Toast from '@/app/components/base/toast'
import ConfigContext from '@/context/debug-configuration'
import type { AgentTool } from '@/types/app'
import { type Collection, CollectionType } from '@/app/components/tools/types'
import { MAX_TOOLS_NUM } from '@/config'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import { updateBuiltInToolCredential } from '@/service/tools'
import cn from '@/utils/classnames'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import { canFindTool } from '@/utils'

type AgentToolWithMoreInfo = AgentTool & { icon: any; collection?: Collection } | null
const AgentTools: FC = () => {
  const { t } = useTranslation()
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const { modelConfig, setModelConfig, collectionList } = useContext(ConfigContext)
  const formattingChangedDispatcher = useFormattingChangedDispatcher()

  const [currentTool, setCurrentTool] = useState<AgentToolWithMoreInfo>(null)
  const currentCollection = useMemo(() => {
    if (!currentTool) return null
    const collection = collectionList.find(collection => canFindTool(collection.id, currentTool?.provider_id) && collection.type === currentTool?.provider_type)
    return collection
  }, [currentTool, collectionList])
  const [isShowSettingTool, setIsShowSettingTool] = useState(false)
  const [isShowSettingAuth, setShowSettingAuth] = useState(false)
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

  const handleToolAuthSetting = (value: any) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      const tool = (draft.agentConfig.tools).find((item: any) => item.provider_id === value?.collection?.id && item.tool_name === value?.tool_name)
      if (tool)
        (tool as AgentTool).notAuthor = false
    })
    setModelConfig(newModelConfig)
    setIsShowSettingTool(false)
    formattingChangedDispatcher()
  }

  const [isDeleting, setIsDeleting] = useState<number>(-1)

  const handleSelectTool = (tool: ToolDefaultValue) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.agentConfig.tools.push({
        provider_id: tool.provider_id,
        provider_type: tool.provider_type as CollectionType,
        provider_name: tool.provider_name,
        tool_name: tool.tool_name,
        tool_label: tool.tool_label,
        tool_parameters: tool.params,
        notAuthor: !tool.is_team_authorization,
        enabled: true,
      })
    })
    setModelConfig(newModelConfig)
  }

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
            <div className='leading-[18px] text-xs font-normal text-text-tertiary'>{tools.filter((item: any) => !!item.enabled).length}/{tools.length}&nbsp;{t('appDebug.agent.tools.enabled')}</div>
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
                  selectedTools={tools}
                />
              </>
            )}
          </div>
        }
      >
        <div className='grid gap-1 grid-cols-1 2xl:grid-cols-2 items-center flex-wrap justify-between'>
          {tools.map((item: AgentTool & { icon: any; collection?: Collection }, index) => (
            <div key={index}
              className={cn(
                'group relative flex justify-between items-center last-of-type:mb-0 p-1.5 pr-2 w-full bg-components-panel-on-panel-item-bg rounded-lg border-[0.5px] border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm cursor',
                isDeleting === index && 'hover:bg-state-destructive-hover border-state-destructive-border',
              )}
            >
              <div className='grow w-0 flex items-center'>
                {item.isDeleted && <DefaultToolIcon className='w-5 h-5' />}
                {!item.isDeleted && (
                  <div className={cn((item.notAuthor || !item.enabled) && 'opacity-50')}>
                    {typeof item.icon === 'string' && <div className='w-5 h-5 bg-cover bg-center rounded-md' style={{ backgroundImage: `url(${item.icon})` }} />}
                    {typeof item.icon !== 'string' && <AppIcon className='rounded-md' size='xs' icon={item.icon?.content} background={item.icon?.background} />}
                  </div>
                )}
                <div
                  className={cn(
                    'grow w-0 ml-1.5 flex items-center system-xs-regular truncate',
                    (item.isDeleted || item.notAuthor || !item.enabled) ? 'opacity-50' : '',
                  )}
                >
                  <span className='text-text-secondary system-xs-medium pr-1.5'>{item.provider_type === CollectionType.builtIn ? item.provider_name.split('/').pop() : item.tool_label}</span>
                  <span className='text-text-tertiary'>{item.tool_label}</span>
                  {!item.isDeleted && (
                    <Tooltip
                      needsDelay
                      popupContent={
                        <div className='w-[180px]'>
                          <div className='mb-1.5 text-text-secondary'>{item.tool_name}</div>
                          <div className='mb-1.5 text-text-tertiary'>{t('tools.toolNameUsageTip')}</div>
                          <div className='text-text-accent cursor-pointer' onClick={() => copy(item.tool_name)}>{t('tools.copyToolName')}</div>
                        </div>
                      }
                    >
                      <div className='w-4 h-4'>
                        <div className='hidden group-hover:inline-block ml-0.5'>
                          <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
                        </div>
                      </div>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className='shrink-0 ml-1 flex items-center'>
                {item.isDeleted && (
                  <div className='flex items-center mr-2'>
                    <Tooltip
                      popupContent={t('tools.toolRemoved')}
                      needsDelay
                    >
                      <div className='mr-1 p-1 rounded-md hover:bg-black/5 cursor-pointer'>
                        <AlertTriangle className='w-4 h-4 text-[#F79009]' />
                      </div>
                    </Tooltip>
                    <div
                      className='p-1 rounded-md text-text-tertiary cursor-pointer hover:text-text-destructive'
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
                      <RiDeleteBinLine className='w-4 h-4' />
                    </div>
                  </div>
                )}
                {!item.isDeleted && (
                  <div className='hidden group-hover:flex items-center gap-1 mr-2'>
                    {!item.notAuthor && (
                      <Tooltip
                        popupContent={t('tools.setBuiltInTools.infoAndSetting')}
                        needsDelay
                      >
                        <div className='p-1 rounded-md hover:bg-black/5  cursor-pointer' onClick={() => {
                          setCurrentTool(item)
                          setIsShowSettingTool(true)
                        }}>
                          <RiEqualizer2Line className='w-4 h-4 text-text-tertiary' />
                        </div>
                      </Tooltip>
                    )}
                    <div
                      className='p-1 rounded-md text-text-tertiary cursor-pointer hover:text-text-destructive'
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
                      <RiDeleteBinLine className='w-4 h-4' />
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
                      setShowSettingAuth(true)
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
          setting={currentTool?.tool_parameters as any}
          collection={currentTool?.collection as Collection}
          isBuiltIn={currentTool?.collection?.type === CollectionType.builtIn}
          isModel={currentTool?.collection?.type === CollectionType.model}
          onSave={handleToolSettingChange}
          onHide={() => setIsShowSettingTool(false)}
        />
      )}
      {isShowSettingAuth && (
        <ConfigCredential
          collection={currentCollection as any}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={async (value) => {
            await updateBuiltInToolCredential((currentCollection as any).name, value)
            Toast.notify({
              type: 'success',
              message: t('common.api.actionSuccess'),
            })
            handleToolAuthSetting(currentTool as any)
            setShowSettingAuth(false)
          }}
        />
      )}
    </>
  )
}
export default React.memo(AgentTools)
