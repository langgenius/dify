import type { ExternalDataTool } from '@/models/common'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
// abandoned
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AppIcon from '@/app/components/base/app-icon'
import {
  Settings01,
} from '@/app/components/base/icons/src/vender/line/general'
import { Tool03 } from '@/app/components/base/icons/src/vender/solid/general'
import Switch from '@/app/components/base/switch'
import { useToastContext } from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import ConfigContext from '@/context/debug-configuration'
import { useModalContext } from '@/context/modal-context'

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
        notify({ type: 'error', message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: promptVariables[i].key }) })
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
        notify({ type: 'error', message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: existedExternalDataTools[i].variable }) })
        return false
      }
    }

    return true
  }
  const handleOpenExternalDataToolModal = (payload: ExternalDataTool, index: number) => {
    setShowExternalDataToolModal({
      payload,
      onSaveCallback: (externalDataTool?: ExternalDataTool) => {
        if (!externalDataTool)
          return
        handleSaveExternalDataToolModal(externalDataTool, index)
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => handleValidateBeforeSaveExternalDataToolModal(newExternalDataTool, index),
    })
  }

  return (
    <div className="mt-3 rounded-xl bg-gray-50 px-3">
      <div className="flex h-12 items-center">
        <div className="flex grow items-center">
          <div
            className={`
              group mr-1 flex h-6 w-6 items-center justify-center rounded-md
              ${externalDataToolsConfig.length && 'hover:bg-white hover:shadow-xs'}
            `}
            onClick={() => setExpanded(v => !v)}
          >
            {
              externalDataToolsConfig.length
                ? <Tool03 className="h-4 w-4 text-[#444CE7] group-hover:hidden" />
                : <Tool03 className="h-4 w-4 text-[#444CE7]" />
            }
            {
              !!externalDataToolsConfig.length && (
                <RiArrowDownSLine className={`hidden h-4 w-4 cursor-pointer text-primary-600 group-hover:block ${expanded ? 'rotate-180' : 'rotate-0'}`} />
              )
            }
          </div>
          <div className="mr-1 text-sm font-semibold text-gray-800">
            {t('feature.tools.title', { ns: 'appDebug' })}
          </div>
          <Tooltip
            popupContent={(
              <div className="max-w-[160px]">
                {t('feature.tools.tips', { ns: 'appDebug' })}
              </div>
            )}
          />
        </div>
        {
          !expanded && !!externalDataToolsConfig.length && (
            <>
              <div className="mr-3 text-xs text-gray-500">{t('feature.tools.toolsInUse', { ns: 'appDebug', count: externalDataToolsConfig.length })}</div>
              <div className="mr-1 h-3.5 w-[1px] bg-gray-200" />
            </>
          )
        }
        <div
          className="flex h-7 cursor-pointer items-center px-3 text-xs font-medium text-gray-700"
          onClick={() => handleOpenExternalDataToolModal({}, -1)}
        >
          <RiAddLine className="mr-[5px] h-3.5 w-3.5 " />
          {t('operation.add', { ns: 'common' })}
        </div>
      </div>
      {
        expanded && !!externalDataToolsConfig.length && (
          <div className="pb-3">
            {
              externalDataToolsConfig.map((item, index: number) => (
                <div
                  key={`${index}-${item.type}-${item.label}-${item.variable}`}
                  className="group mb-1 flex items-center rounded-lg border-[0.5px] border-gray-200 bg-white px-2.5 py-2 shadow-xs last-of-type:mb-0"
                >
                  <div className="flex grow items-center">
                    <AppIcon
                      size="large"
                      className="mr-2 !h-6 !w-6 rounded-md border-[0.5px] border-black/5"
                      icon={item.icon}
                      background={item.icon_background}
                    />
                    <div className="mr-2 text-[13px] font-medium text-gray-800">{item.label}</div>
                    <Tooltip
                      popupContent={copied ? t('copied', { ns: 'appApi' }) : `${item.variable}, ${t('copy', { ns: 'appApi' })}`}
                    >
                      <div
                        className="text-xs text-gray-500"
                        onClick={() => {
                          copy(item.variable || '')
                          setCopied(true)
                        }}
                      >
                        {item.variable}
                      </div>
                    </Tooltip>
                  </div>
                  <div
                    className="mr-1 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5 group-hover:flex"
                    onClick={() => handleOpenExternalDataToolModal(item, index)}
                  >
                    <Settings01 className="h-4 w-4 text-gray-500" />
                  </div>
                  <div
                    className="group/action hidden h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-[#FEE4E2] group-hover:flex"
                    onClick={() => setExternalDataToolsConfig([...externalDataToolsConfig.slice(0, index), ...externalDataToolsConfig.slice(index + 1)])}
                  >
                    <RiDeleteBinLine className="h-4 w-4 text-gray-500 group-hover/action:text-[#D92D20]" />
                  </div>
                  <div className="ml-2 mr-3 hidden h-3.5 w-[1px] bg-gray-200 group-hover:block" />
                  <Switch
                    size="l"
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
