'use client'
import type { FC } from 'react'
import React from 'react'
import copy from 'copy-to-clipboard'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { Clipboard, ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { ExternalDataTool } from '@/models/common'
import ConfigContext from '@/context/debug-configuration'
import { useModalContext } from '@/context/modal-context'
import { useToastContext } from '@/app/components/base/toast'

import s from '@/app/components/app/configuration/config-prompt/style.module.css'
type Props = {
  className?: string
  type: 'first-prompt' | 'next-iteration'
  value: string
  onChange: (value: string) => void
}

const Editor: FC<Props> = ({
  className,
  type,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  const { notify } = useToastContext()

  const [isCopied, setIsCopied] = React.useState(false)
  const {
    modelConfig,
    hasSetBlockStatus,
    dataSets,
    showSelectDataSet,
    externalDataToolsConfig,
    setExternalDataToolsConfig,
  } = useContext(ConfigContext)
  const promptVariables = modelConfig.configs.prompt_variables
  const { setShowExternalDataToolModal } = useModalContext()
  const isFirstPrompt = type === 'first-prompt'
  const editorHeight = isFirstPrompt ? 'h-[336px]' : 'h-[52px]'

  const handleOpenExternalDataToolModal = () => {
    setShowExternalDataToolModal({
      payload: {},
      onSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        setExternalDataToolsConfig([...externalDataToolsConfig, newExternalDataTool])
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        for (let i = 0; i < promptVariables.length; i++) {
          if (promptVariables[i].key === newExternalDataTool.variable) {
            notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: promptVariables[i].key }) })
            return false
          }
        }

        for (let i = 0; i < externalDataToolsConfig.length; i++) {
          if (externalDataToolsConfig[i].variable === newExternalDataTool.variable) {
            notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: externalDataToolsConfig[i].variable }) })
            return false
          }
        }

        return true
      },
    })
  }
  return (
    <div className={cn(className, s.gradientBorder, 'relative')}>
      <div className='rounded-xl bg-white'>
        <div className={cn(s.boxHeader, 'flex justify-between items-center h-11 pt-2 pr-3 pb-1 pl-4 rounded-tl-xl rounded-tr-xl bg-white hover:shadow-xs')}>
          <div className='text-sm font-semibold uppercase text-indigo-800'>{t(`appDebug.agent.${isFirstPrompt ? 'firstPrompt' : 'nextIteration'}`)}</div>
          <div className={cn(s.optionWrap, 'items-center space-x-1')}>
            {!isCopied
              ? (
                <Clipboard className='h-6 w-6 p-1 text-gray-500 cursor-pointer' onClick={() => {
                  copy(value)
                  setIsCopied(true)
                }} />
              )
              : (
                <ClipboardCheck className='h-6 w-6 p-1 text-gray-500' />
              )}
          </div>
        </div>
        <div className={cn(editorHeight, ' px-4 min-h-[102px] overflow-y-auto text-sm text-gray-700')}>
          <PromptEditor
            className={editorHeight}
            value={value}
            contextBlock={{
              show: true,
              selectable: !hasSetBlockStatus.context,
              datasets: dataSets.map(item => ({
                id: item.id,
                name: item.name,
                type: item.data_source_type,
              })),
              onAddContext: showSelectDataSet,
            }}
            variableBlock={{
              show: true,
              variables: modelConfig.configs.prompt_variables.map(item => ({
                name: item.name,
                value: item.key,
              })),
            }}
            externalToolBlock={{
              show: true,
              externalTools: externalDataToolsConfig.map(item => ({
                name: item.label!,
                variableName: item.variable!,
                icon: item.icon,
                icon_background: item.icon_background,
              })),
              onAddExternalTool: handleOpenExternalDataToolModal,
            }}
            historyBlock={{
              show: false,
              selectable: false,
              history: {
                user: '',
                assistant: '',
              },
              onEditRole: () => { },
            }}
            queryBlock={{
              show: false,
              selectable: false,
            }}
            onChange={onChange}
            onBlur={() => { }}
          />
        </div>
        <div className='pl-4 pb-2 flex'>
          <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{value.length}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(Editor)
