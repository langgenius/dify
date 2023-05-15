'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '../base/feature-panel'
import Tooltip from '@/app/components/base/tooltip'
import type { PromptVariable } from '@/models/debug'
import { Cog8ToothIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useBoolean } from 'ahooks'
import EditModel from './config-model'
import { DEFAULT_VALUE_MAX_LEN, getMaxVarNameLength } from '@/config'
import { getNewVar } from '@/utils/var'
import OperationBtn from '../base/operation-btn'
import Switch from '@/app/components/base/switch'
import IconTypeIcon from './input-type-icon'
import { checkKeys } from '@/utils/var'
import Toast from '@/app/components/base/toast'

import s from './style.module.css'
import VarIcon from '../base/icons/var-icon'

export type IConfigVarProps = {
  promptVariables: PromptVariable[]
  onPromptVariablesChange: (promptVariables: PromptVariable[]) => void
}

const ConfigVar: FC<IConfigVarProps> = ({ promptVariables, onPromptVariablesChange }) => {
  const { t } = useTranslation()
  const hasVar = promptVariables.length > 0
  const promptVariableObj = (() => {
    const obj: Record<string, boolean> = {}
    promptVariables.forEach((item) => {
      obj[item.key] = true
    })
    return obj
  })()

  const updatePromptVariable = (key: string, updateKey: string, newValue: any) => {
    if (!(key in promptVariableObj))
      return
    const newPromptVariables = promptVariables.map((item) => {
      if (item.key === key)
        return {
          ...item,
          [updateKey]: newValue
        }

      return item
    })

    onPromptVariablesChange(newPromptVariables)
  }

  const batchUpdatePromptVariable = (key: string, updateKeys: string[], newValues: any[]) => {
    if (!(key in promptVariableObj))
      return
    const newPromptVariables = promptVariables.map((item) => {
      if (item.key === key) {
        const newItem: any = { ...item }
        updateKeys.forEach((updateKey, i) => {
          newItem[updateKey] = newValues[i]
        })
        return newItem
      }

      return item
    })

    onPromptVariablesChange(newPromptVariables)
  }


  const updatePromptKey = (index: number, newKey: string) => {
    const { isValid, errorKey, errorMessageKey } = checkKeys([newKey], true)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey })
      })
      return
    }
    const newPromptVariables = promptVariables.map((item, i) => {
      if (i === index)
        return {
          ...item,
          key: newKey,
        }

      return item
    })

    onPromptVariablesChange(newPromptVariables)
  }

  const updatePromptNameIfNameEmpty = (index: number, newKey: string) => {
    if (!newKey) return
    const newPromptVariables = promptVariables.map((item, i) => {
      if (i === index && !item.name)
        return {
          ...item,
          name: newKey,
        }
      return item
    })

    onPromptVariablesChange(newPromptVariables)
  }

  const handleAddVar = () => {
    const newVar = getNewVar('')
    onPromptVariablesChange([...promptVariables, newVar])
  }

  const handleRemoveVar = (index: number) => {
    onPromptVariablesChange(promptVariables.filter((_, i) => i !== index))
  }

  const [currKey, setCurrKey] = useState<string | null>(null)
  const currItem = currKey ? promptVariables.find(item => item.key === currKey) : null
  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)
  const handleConfig = (key: string) => {
    setCurrKey(key)
    showEditModal()
  }

  return (
    <Panel
      className="mt-4"
      headerIcon={
        <VarIcon />
      }
      title={
        <div className='flex items-center gap-2'>
          <div>{t('appDebug.variableTitle')}</div>
          <Tooltip htmlContent={<div className='w-[180px]'>
            {t('appDebug.variableTip')}
          </div>} selector='config-var-tooltip'>
            <svg width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.66667 11.1667H8V8.5H7.33333M8 5.83333H8.00667M14 8.5C14 9.28793 13.8448 10.0681 13.5433 10.7961C13.2417 11.5241 12.7998 12.1855 12.2426 12.7426C11.6855 13.2998 11.0241 13.7417 10.2961 14.0433C9.56815 14.3448 8.78793 14.5 8 14.5C7.21207 14.5 6.43185 14.3448 5.7039 14.0433C4.97595 13.7417 4.31451 13.2998 3.75736 12.7426C3.20021 12.1855 2.75825 11.5241 2.45672 10.7961C2.15519 10.0681 2 9.28793 2 8.5C2 6.9087 2.63214 5.38258 3.75736 4.25736C4.88258 3.13214 6.4087 2.5 8 2.5C9.5913 2.5 11.1174 3.13214 12.2426 4.25736C13.3679 5.38258 14 6.9087 14 8.5Z" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Tooltip>
        </div>
      }
      headerRight={<OperationBtn type="add" onClick={handleAddVar} />}
    >
      {!hasVar && (
        <div className='pt-2 pb-1 text-xs text-gray-500'>{t('appDebug.notSetVar')}</div>
      )}
      {hasVar && (
        <div className='rounded-lg border border-gray-200 bg-white'>
          <table className={`${s.table} w-full border-collapse border-0 rounded-lg text-sm`}>
            <thead className="border-b  border-gray-200 text-gray-500 text-xs font-medium">
              <tr className='uppercase'>
                <td>{t('appDebug.variableTable.key')}</td>
                <td>{t('appDebug.variableTable.name')}</td>
                <td>{t('appDebug.variableTable.optional')}</td>
                <td>{t('appDebug.variableTable.action')}</td>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {promptVariables.map(({ key, name, type, required }, index) => (
                <tr key={index} className="h-9 leading-9">
                  <td className="w-[160px] border-b border-gray-100 pl-3">
                    <div className='flex items-center space-x-1'>
                      <IconTypeIcon type={type} />
                      <input
                        type="text"
                        placeholder="key"
                        value={key}
                        onChange={e => updatePromptKey(index, e.target.value)}
                        onBlur={e => updatePromptNameIfNameEmpty(index, e.target.value)}
                        maxLength={getMaxVarNameLength(name)}
                        className="h-6 leading-6 block w-full rounded-md border-0 py-1.5 text-gray-900  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                      />
                    </div>
                  </td>
                  <td className="py-1 border-b border-gray-100">
                    <input
                      type="text"
                      placeholder={key}
                      value={name}
                      onChange={e => updatePromptVariable(key, 'name', e.target.value)}
                      maxLength={getMaxVarNameLength(name)}
                      className="h-6 leading-6 block w-full rounded-md border-0 py-1.5 text-gray-900  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                    />
                  </td>
                  <td className='w-[84px] border-b border-gray-100'>
                    <div className='flex items-center h-full'>
                      <Switch defaultValue={!required} size='md' onChange={(value) => updatePromptVariable(key, 'required', !value)} />
                    </div>
                  </td>
                  <td className='w-20  border-b border-gray-100'>
                    <div className='flex h-full items-center space-x-1'>
                      <div className='flex items-center justify-items-center w-6 h-6 text-gray-500 cursor-pointer' onClick={() => handleConfig(key)}>
                        <Cog8ToothIcon width={16} height={16} />
                      </div>
                      <div className='flex items-center justify-items-center w-6 h-6 text-gray-500 cursor-pointer' onClick={() => handleRemoveVar(index)} >
                        <TrashIcon width={16} height={16} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isShowEditModal && (
        <EditModel
          payload={currItem as PromptVariable}
          isShow={isShowEditModal}
          onClose={hideEditModal}
          onConfirm={({ type, value }) => {
            if (type === 'string') {
              batchUpdatePromptVariable(currKey as string, ['type', 'max_length'], [type, value || DEFAULT_VALUE_MAX_LEN])
            } else {
              batchUpdatePromptVariable(currKey as string, ['type', 'options'], [type, value || []])
            }
            hideEditModal()
          }}
        />
      )}

    </Panel>
  )
}
export default React.memo(ConfigVar)
