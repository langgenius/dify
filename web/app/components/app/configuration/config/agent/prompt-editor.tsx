'use client'
import type { FC } from 'react'
import type { ExternalDataTool } from '@/models/common'
import copy from 'copy-to-clipboard'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import s from '@/app/components/app/configuration/config-prompt/style.module.css'
import {
  Copy,
  CopyCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useToastContext } from '@/app/components/base/toast'
import ConfigContext from '@/context/debug-configuration'
import { useModalContext } from '@/context/modal-context'
import { cn } from '@/utils/classnames'

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
      onSaveCallback: (newExternalDataTool?: ExternalDataTool) => {
        if (!newExternalDataTool)
          return
        setExternalDataToolsConfig([...externalDataToolsConfig, newExternalDataTool])
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        for (let i = 0; i < promptVariables.length; i++) {
          if (promptVariables[i].key === newExternalDataTool.variable) {
            notify({ type: 'error', message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: promptVariables[i].key }) })
            return false
          }
        }

        for (let i = 0; i < externalDataToolsConfig.length; i++) {
          if (externalDataToolsConfig[i].variable === newExternalDataTool.variable) {
            notify({ type: 'error', message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: externalDataToolsConfig[i].variable }) })
            return false
          }
        }

        return true
      },
    })
  }
  return (
    <div className={cn(className, s.gradientBorder, 'relative')}>
      <div className="rounded-xl bg-white">
        <div className={cn(s.boxHeader, 'flex h-11 items-center justify-between rounded-tl-xl rounded-tr-xl bg-white pb-1 pl-4 pr-3 pt-2 hover:shadow-xs')}>
          <div className="text-sm font-semibold uppercase text-indigo-800">{t(`agent.${isFirstPrompt ? 'firstPrompt' : 'nextIteration'}`, { ns: 'appDebug' })}</div>
          <div className={cn(s.optionWrap, 'items-center space-x-1')}>
            {!isCopied
              ? (
                  <Copy
                    className="h-6 w-6 cursor-pointer p-1 text-gray-500"
                    onClick={() => {
                      copy(value)
                      setIsCopied(true)
                    }}
                  />
                )
              : (
                  <CopyCheck className="h-6 w-6 p-1 text-gray-500" />
                )}
          </div>
        </div>
        <div className={cn(editorHeight, ' min-h-[102px] overflow-y-auto px-4 text-sm text-gray-700')}>
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
              variables: modelConfig.configs.prompt_variables.filter(item => item.key && item.key.trim() && item.name && item.name.trim()).map(item => ({
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
              onEditRole: noop,
            }}
            queryBlock={{
              show: false,
              selectable: false,
            }}
            onChange={onChange}
            onBlur={noop}
          />
        </div>
        <div className="flex pb-2 pl-4">
          <div className="h-[18px] rounded-md bg-gray-100 px-1 text-xs leading-[18px] text-gray-500">{value.length}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(Editor)
