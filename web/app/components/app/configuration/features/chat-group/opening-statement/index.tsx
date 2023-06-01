'use client'
import React, { FC, useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import ConfigContext from '@/context/debug-configuration'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import Button from '@/app/components/base/button'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import { getInputKeys } from '@/app/components/base/block-input'
import ConfirmAddVar from '@/app/components/app/configuration/config-prompt/confirm-add-var'
import { getNewVar } from '@/utils/var'
import { varHighlightHTML } from '@/app/components/app/configuration/base/var-highlight'

export interface IOpeningStatementProps {
  promptTemplate: string
  value: string
  onChange: (value: string) => void
}

// regex to match the {{}} and replace it with a span
const regex = /\{\{([^}]+)\}\}/g

const OpeningStatement: FC<IOpeningStatementProps> = ({
  value = '',
  onChange
}) => {
  const { t } = useTranslation()
  const {
    modelConfig,
    setModelConfig,
  } = useContext(ConfigContext)
  const promptVariables = modelConfig.configs.prompt_variables
  const [notIncludeKeys, setNotIncludeKeys] = useState<string[]>([])

  const hasValue = !!(value || '').trim()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [isFocus, { setTrue: didSetFocus, setFalse: setBlur }] = useBoolean(false)
  const setFocus = () => {
    didSetFocus()
    setTimeout(() => {
      const input = inputRef.current
      if (input) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    }, 0)
  }

  const [tempValue, setTempValue] = useState(value)
  useEffect(() => {
    setTempValue(value || '')
  }, [value])

  const coloredContent = (tempValue || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(regex, varHighlightHTML({ name: '$1' })) // `<span class="${highLightClassName}">{{$1}}</span>`
    .replace(/\n/g, '<br />')
    


  const handleEdit = () => {
    setFocus()
  }

  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)

  const handleCancel = () => {
    setBlur()
    setTempValue(value)
  }

  const handleConfirm = () => {
    const keys = getInputKeys(tempValue)
    const promptKeys = promptVariables.map((item) => item.key)
    let notIncludeKeys: string[] = []

    if (promptKeys.length === 0) {
      if (keys.length > 0) {
        notIncludeKeys = keys
      }
    } else {
      notIncludeKeys = keys.filter((key) => !promptKeys.includes(key))
    }

    if (notIncludeKeys.length > 0) {
      setNotIncludeKeys(notIncludeKeys)
      showConfirmAddVar()
      return
    }
    setBlur()
    onChange(tempValue)
  }

  const cancelAutoAddVar = () => {
    onChange(tempValue)
    hideConfirmAddVar()
    setBlur()
  }

  const autoAddVar = () => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...notIncludeKeys.map((key) => getNewVar(key))]
    })
    onChange(tempValue)
    setModelConfig(newModelConfig)
    hideConfirmAddVar()
    setBlur()
  }

  const headerRight = (
    <OperationBtn type='edit' actionName={hasValue ? '' : t('appDebug.openingStatement.writeOpner') as string} onClick={handleEdit} />
  )

  return (
    <Panel
      className={cn(isShowConfirmAddVar && 'h-[220px]', 'relative mt-4')}
      title={t('appDebug.openingStatement.title')}
      headerIcon={
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" clipRule="evenodd" d="M8.33353 1.33301C4.83572 1.33301 2.00019 4.16854 2.00019 7.66634C2.00019 8.37301 2.11619 9.05395 2.3307 9.69036C2.36843 9.80229 2.39063 9.86853 2.40507 9.91738L2.40979 9.93383L2.40729 9.93903C2.39015 9.97437 2.36469 10.0218 2.31705 10.11L1.2158 12.1484C1.14755 12.2746 1.07633 12.4064 1.02735 12.5209C0.978668 12.6348 0.899813 12.8437 0.938613 13.0914C0.984094 13.3817 1.15495 13.6373 1.40581 13.7903C1.61981 13.9208 1.843 13.9279 1.96683 13.9264C2.09141 13.925 2.24036 13.9095 2.38314 13.8947L5.81978 13.5395C5.87482 13.5338 5.9036 13.5309 5.92468 13.5292L5.92739 13.529L5.93564 13.532C5.96154 13.5413 5.99666 13.5548 6.0573 13.5781C6.76459 13.8506 7.53244 13.9997 8.33353 13.9997C11.8313 13.9997 14.6669 11.1641 14.6669 7.66634C14.6669 4.16854 11.8313 1.33301 8.33353 1.33301ZM5.9799 5.72116C6.73142 5.08698 7.73164 5.27327 8.33144 5.96584C8.93125 5.27327 9.91854 5.09365 10.683 5.72116C11.4474 6.34867 11.5403 7.41567 10.9501 8.16572C10.5845 8.6304 9.6668 9.47911 9.02142 10.0576C8.78435 10.2702 8.66582 10.3764 8.52357 10.4192C8.40154 10.456 8.26134 10.456 8.13931 10.4192C7.99706 10.3764 7.87853 10.2702 7.64147 10.0576C6.99609 9.47911 6.07839 8.6304 5.71276 8.16572C5.12259 7.41567 5.22839 6.35534 5.9799 5.72116Z" fill="#E74694" />
        </svg>
      }
      headerRight={headerRight}
      hasHeaderBottomBorder={!hasValue}
      isFocus={isFocus}
    >
      <div className='text-gray-700 text-sm'>
        {(hasValue || (!hasValue && isFocus)) ? (
          <>
            {isFocus ? (
              <textarea
                ref={inputRef}
                value={tempValue}
                rows={3}
                onChange={e => setTempValue(e.target.value)}
                className="w-full px-0 text-sm  border-0 bg-transparent  focus:outline-none "
                placeholder={t('appDebug.openingStatement.placeholder') as string}
              >
              </textarea>
            ) : (
              <div dangerouslySetInnerHTML={{
                __html: coloredContent
              }}></div>
            )}

            {/* Operation Bar */}
            {isFocus && (
              <div className='mt-2 flex items-center justify-between'>
                <div className='text-xs text-gray-500'>{t('appDebug.openingStatement.varTip')}</div>

                <div className='flex gap-2'>
                  <Button className='!h-8 text-sm' onClick={handleCancel}>{t('common.operation.cancel')}</Button>
                  <Button className='!h-8 text-sm' onClick={handleConfirm} type="primary">{t('common.operation.save')}</Button>
                </div>
              </div>
            )}

          </>) : (
          <div className='pt-2 pb-1 text-xs text-gray-500'>{t('appDebug.openingStatement.noDataPlaceHolder')}</div>
        )}

        {isShowConfirmAddVar && (
          <ConfirmAddVar
            varNameArr={notIncludeKeys}
            onConfrim={autoAddVar}
            onCancel={cancelAutoAddVar}
            onHide={hideConfirmAddVar}
          />
        )}

      </div>
    </Panel>
  )
}
export default React.memo(OpeningStatement)
