// abandoned
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import { useContext } from 'use-context-selector'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiQuestionLine,
} from '@remixicon/react'
import ConfigContext from '@/context/debug-configuration'
import Switch from '@/app/components/base/switch'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { Tool03 } from '@/app/components/base/icons/src/vender/solid/general'
import {
  Settings01,
} from '@/app/components/base/icons/src/vender/line/general'
import { useModalContext } from '@/context/modal-context'
import type { ExternalDataTool } from '@/models/common'
import AppIcon from '@/app/components/base/app-icon'
import { useToastContext } from '@/app/components/base/toast'

const Tools = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { setShowExternalDataToolModal } = useModalContext()
  const {
    externalDataToolsConfig,
    setExternalDataToolsConfig,
    modelConfig,
  } = useContext(ConfigContext)
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleSaveExternalDataToolModal = (externalDataTool: ExternalDataTool, index: number) => {
    if (index > -1) {
      setExternalDataToolsConfig([
        ...externalDataToolsConfig.slice(0, index),
        externalDataTool,
        ...externalDataToolsConfig.slice(index + 1),
      ])
    }
    else {
      setExternalDataToolsConfig([...externalDataToolsConfig, externalDataTool])
    }
  }
  const handleValidateBeforeSaveExternalDataToolModal = (newExternalDataTool: ExternalDataTool, index: number) => {
    const promptVariables = modelConfig?.configs?.prompt_variables || []
    for (let i = 0; i < promptVariables.length; i++) {
      if (promptVariables[i].key === newExternalDataTool.variable) {
        notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: promptVariables[i].key }) })
        return false
      }
    }

    let existedExternalDataTools = []
    if (index > -1) {
      existedExternalDataTools = [
        ...externalDataToolsConfig.slice(0, index),
        ...externalDataToolsConfig.slice(index + 1),
      ]
    }
    else {
      existedExternalDataTools = [...externalDataToolsConfig]
    }

    for (let i = 0; i < existedExternalDataTools.length; i++) {
      if (existedExternalDataTools[i].variable === newExternalDataTool.variable) {
        notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: existedExternalDataTools[i].variable }) })
        return false
      }
    }

    return true
  }
  const handleOpenExternalDataToolModal = (payload: ExternalDataTool, index: number) => {
    setShowExternalDataToolModal({
      payload,
      onSaveCallback: (externalDataTool: ExternalDataTool) => handleSaveExternalDataToolModal(externalDataTool, index),
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => handleValidateBeforeSaveExternalDataToolModal(newExternalDataTool, index),
    })
  }

  return (
    <div className='mt-3 px-3 rounded-xl bg-gray-50'>
      <div className='flex items-center h-12'>
        <div className='grow flex items-center'>
          <div
            className={`
              group flex items-center justify-center mr-1 w-6 h-6 rounded-md 
              ${externalDataToolsConfig.length && 'hover:shadow-xs hover:bg-white'}
            `}
            onClick={() => setExpanded(v => !v)}
          >
            {
              externalDataToolsConfig.length
                ? <Tool03 className='group-hover:hidden w-4 h-4 text-[#444CE7]' />
                : <Tool03 className='w-4 h-4 text-[#444CE7]' />
            }
            {
              !!externalDataToolsConfig.length && (
                <RiArrowDownSLine className={`hidden group-hover:block w-4 h-4 text-primary-600 cursor-pointer ${expanded ? 'rotate-180' : 'rotate-0'}`} />
              )
            }
          </div>
          <div className='mr-1 text-sm font-semibold text-gray-800'>
            {t('appDebug.feature.tools.title')}
          </div>
          <TooltipPlus popupContent={<div className='max-w-[160px]'>{t('appDebug.feature.tools.tips')}</div>}>
            <RiQuestionLine className='w-3.5 h-3.5 text-gray-400' />
          </TooltipPlus>
        </div>
        {
          !expanded && !!externalDataToolsConfig.length && (
            <>
              <div className='mr-3 text-xs text-gray-500'>{t('appDebug.feature.tools.toolsInUse', { count: externalDataToolsConfig.length })}</div>
              <div className='mr-1 w-[1px] h-3.5 bg-gray-200' />
            </>
          )
        }
        <div
          className='flex items-center h-7 px-3 text-xs font-medium text-gray-700 cursor-pointer'
          onClick={() => handleOpenExternalDataToolModal({}, -1)}
        >
          <RiAddLine className='mr-[5px] w-3.5 h-3.5 ' />
          {t('common.operation.add')}
        </div>
      </div>
      {
        expanded && !!externalDataToolsConfig.length && (
          <div className='pb-3'>
            {
              externalDataToolsConfig.map((item, index: number) => (
                <div
                  key={`${index}-${item.type}-${item.label}-${item.variable}`}
                  className='group flex items-center mb-1 last-of-type:mb-0 px-2.5 py-2 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'
                >
                  <div className='grow flex items-center'>
                    <AppIcon size='large'
                      className='mr-2 !w-6 !h-6 rounded-md border-[0.5px] border-black/5'
                      icon={item.icon}
                      background={item.icon_background}
                    />
                    <div className='mr-2 text-[13px] font-medium text-gray-800'>{item.label}</div>
                    <TooltipPlus
                      popupContent={copied ? t('appApi.copied') : `${item.variable}, ${t('appApi.copy')}`}
                    >
                      <div
                        className='text-xs text-gray-500'
                        onClick={() => {
                          copy(item.variable || '')
                          setCopied(true)
                        }}
                      >
                        {item.variable}
                      </div>
                    </TooltipPlus>
                  </div>
                  <div
                    className='hidden group-hover:flex items-center justify-center mr-1 w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
                    onClick={() => handleOpenExternalDataToolModal(item, index)}
                  >
                    <Settings01 className='w-4 h-4 text-gray-500' />
                  </div>
                  <div
                    className='hidden group/action group-hover:flex items-center justify-center w-6 h-6 hover:bg-[#FEE4E2] rounded-md cursor-pointer'
                    onClick={() => setExternalDataToolsConfig([...externalDataToolsConfig.slice(0, index), ...externalDataToolsConfig.slice(index + 1)])}
                  >
                    <RiDeleteBinLine className='w-4 h-4 text-gray-500 group-hover/action:text-[#D92D20]' />
                  </div>
                  <div className='hidden group-hover:block ml-2 mr-3 w-[1px] h-3.5 bg-gray-200' />
                  <Switch
                    size='l'
                    defaultValue={item.enabled}
                    onChange={(enabled: boolean) => handleSaveExternalDataToolModal({ ...item, enabled }, index)}
                  />
                </div>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default Tools
