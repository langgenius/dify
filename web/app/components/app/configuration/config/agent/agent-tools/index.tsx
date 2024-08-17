'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import {
  RiDeleteBinLine,
  RiHammerFill,
} from '@remixicon/react'
import { useFormattingChangedDispatcher } from '../../../debug/hooks'
import SettingBuiltInTool from './setting-built-in-tool'
import cn from '@/utils/classnames'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import AppIcon from '@/app/components/base/app-icon'
import Switch from '@/app/components/base/switch'
import ConfigContext from '@/context/debug-configuration'
import type { AgentTool } from '@/types/app'
import { type Collection, CollectionType } from '@/app/components/tools/types'
import { MAX_TOOLS_NUM } from '@/config'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import AddToolModal from '@/app/components/tools/add-tool-modal'

type AgentToolWithMoreInfo = AgentTool & { icon: any; collection?: Collection } | null
const AgentTools: FC = () => {
  const { t } = useTranslation()
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const { modelConfig, setModelConfig, collectionList } = useContext(ConfigContext)
  const formattingChangedDispatcher = useFormattingChangedDispatcher()

  const [currentTool, setCurrentTool] = useState<AgentToolWithMoreInfo>(null)
  const [isShowSettingTool, setIsShowSettingTool] = useState(false)
  const tools = (modelConfig?.agentConfig?.tools as AgentTool[] || []).map((item) => {
    const collection = collectionList.find(collection => collection.id === item.provider_id && collection.type === item.provider_type)
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

  return (
    <>
      <Panel
        className="mt-4"
        noBodySpacing={tools.length === 0}
        headerIcon={
          <RiHammerFill className='w-4 h-4 text-primary-500' />
        }
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
            <div className='leading-[18px] text-xs font-normal text-gray-500'>{tools.filter((item: any) => !!item.enabled).length}/{tools.length}&nbsp;{t('appDebug.agent.tools.enabled')}</div>
            {tools.length < MAX_TOOLS_NUM && (
              <>
                <div className='ml-3 mr-1 h-3.5 w-px bg-gray-200'></div>
                <OperationBtn type="add" onClick={() => setIsShowChooseTool(true)} />
              </>
            )}
          </div>
        }
      >
        <div className='grid gap-1 grid-cols-1 2xl:grid-cols-2 items-center flex-wrap justify-between'>
          {tools.map((item: AgentTool & { icon: any; collection?: Collection }, index) => (
            <div key={index}
              className={cn((item.isDeleted || item.notAuthor) ? 'bg-white/50' : 'bg-white', (item.enabled && !item.isDeleted && !item.notAuthor) && 'shadow-xs', index > 1 && 'mt-1', 'group relative flex justify-between items-center last-of-type:mb-0  pl-2.5 py-2 pr-3 w-full  rounded-lg border-[0.5px] border-gray-200 ')}
            >
              <div className='grow w-0 flex items-center'>
                {(item.isDeleted || item.notAuthor)
                  ? (
                    <DefaultToolIcon className='w-6 h-6' />
                  )
                  : (
                    typeof item.icon === 'string'
                      ? (
                        <div
                          className='w-6 h-6 bg-cover bg-center rounded-md'
                          style={{
                            backgroundImage: `url(${item.icon})`,
                          }}
                        ></div>
                      )
                      : (
                        <AppIcon
                          className='rounded-md'
                          size='tiny'
                          icon={item.icon?.content}
                          background={item.icon?.background}
                        />
                      ))}
                <div
                  className={cn((item.isDeleted || item.notAuthor) ? 'line-through opacity-50' : '', 'grow w-0 ml-2 leading-[18px] text-[13px] font-medium text-gray-800  truncate')}
                >
                  <span className='text-gray-800 pr-2'>{item.provider_type === CollectionType.builtIn ? item.provider_name : item.tool_label}</span>
                  <Tooltip
                    popupContent={t('tools.toolNameUsageTip')}
                  >
                    <span className='text-gray-500'>{item.tool_name}</span>
                  </Tooltip>
                </div>
              </div>
              <div className='shrink-0 ml-1 flex items-center'>
                {(item.isDeleted || item.notAuthor)
                  ? (
                    <div className='flex items-center'>
                      <Tooltip
                        popupContent={t(`tools.${item.isDeleted ? 'toolRemoved' : 'notAuthorized'}`)}
                        needsDelay
                      >
                        <div className='mr-1 p-1 rounded-md hover:bg-black/5  cursor-pointer' onClick={() => {
                          if (item.notAuthor)
                            setIsShowChooseTool(true)
                        }}>
                          <AlertTriangle className='w-4 h-4 text-[#F79009]' />
                        </div>
                      </Tooltip>

                      <div className='p-1 rounded-md hover:bg-black/5 cursor-pointer' onClick={() => {
                        const newModelConfig = produce(modelConfig, (draft) => {
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}>
                        <RiDeleteBinLine className='w-4 h-4 text-gray-500' />
                      </div>
                      <div className='ml-2 mr-3 w-px h-3.5 bg-gray-200'></div>
                    </div>
                  )
                  : (
                    <div className='hidden group-hover:flex items-center'>
                      <Tooltip
                        popupContent={t('tools.setBuiltInTools.infoAndSetting')}
                        needsDelay
                      >
                        <div className='p-1 rounded-md hover:bg-black/5  cursor-pointer' onClick={() => {
                          setCurrentTool(item)
                          setIsShowSettingTool(true)
                        }}>
                          <InfoCircle className='w-4 h-4 text-gray-500' />
                        </div>
                      </Tooltip>

                      <div className='p-1 rounded-md hover:bg-black/5 cursor-pointer' onClick={() => {
                        const newModelConfig = produce(modelConfig, (draft) => {
                          draft.agentConfig.tools.splice(index, 1)
                        })
                        setModelConfig(newModelConfig)
                        formattingChangedDispatcher()
                      }}>
                        <RiDeleteBinLine className='w-4 h-4 text-gray-500' />
                      </div>
                      <div className='ml-2 mr-3 w-px h-3.5 bg-gray-200'></div>
                    </div>
                  )}
                <div className={cn((item.isDeleted || item.notAuthor) && 'opacity-50')}>
                  <Switch
                    defaultValue={(item.isDeleted || item.notAuthor) ? false : item.enabled}
                    disabled={(item.isDeleted || item.notAuthor)}
                    size='md'
                    onChange={(enabled) => {
                      const newModelConfig = produce(modelConfig, (draft) => {
                        (draft.agentConfig.tools[index] as any).enabled = enabled
                      })
                      setModelConfig(newModelConfig)
                      formattingChangedDispatcher()
                    }} />
                </div>
              </div>
            </div>
          ))}
        </div >
      </Panel >
      {isShowChooseTool && (
        <AddToolModal onHide={() => setIsShowChooseTool(false)} />
      )}
      {
        isShowSettingTool && (
          <SettingBuiltInTool
            toolName={currentTool?.tool_name as string}
            setting={currentTool?.tool_parameters as any}
            collection={currentTool?.collection as Collection}
            isBuiltIn={currentTool?.collection?.type === CollectionType.builtIn}
            isModel={currentTool?.collection?.type === CollectionType.model}
            onSave={handleToolSettingChange}
            onHide={() => setIsShowSettingTool(false)}
          />)
      }
    </>
  )
}
export default React.memo(AgentTools)
