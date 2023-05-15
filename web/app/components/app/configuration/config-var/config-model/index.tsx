'use client'
import React, { FC, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import ModalFoot from '../modal-foot'
import ConfigSelect, { Options } from '../config-select'
import ConfigString from '../config-string'
import Toast from '@/app/components/base/toast'
import type { PromptVariable } from '@/models/debug'
import SelectTypeItem from '../select-type-item'
import { getNewVar } from '@/utils/var'

import s from './style.module.css'

export interface IConfigModalProps {
  payload: PromptVariable
  type?: string
  isShow: boolean
  onClose: () => void
  onConfirm: (newValue: { type: string, value: any }) => void
}

const ConfigModal: FC<IConfigModalProps> = ({
  payload,
  isShow,
  onClose,
  onConfirm
}) => {
  const { t } = useTranslation()
  const { type, name, key, options, max_length } = payload || getNewVar('')

  const [tempType, setTempType] = useState(type)
  useEffect(() => {
    setTempType(type)
  }, [type])
  const handleTypeChange = (type: string) => {
    return () => {
      setTempType(type)
    }
  }

  const isStringInput = tempType === 'string'
  const title = isStringInput ? t('appDebug.variableConig.maxLength') : t('appDebug.variableConig.options')

  // string type 
  const [tempMaxLength, setTempMaxValue] = useState(max_length)
  useEffect(() => {
    setTempMaxValue(max_length)
  }, [max_length])

  // select type
  const [tempOptions, setTempOptions] = useState<Options>(options || [])
  useEffect(() => {
    setTempOptions(options || [])
  }, [options])

  const handleConfirm = () => {
    if (isStringInput) {
      onConfirm({ type: tempType, value: tempMaxLength })
    } else {
      if (tempOptions.length === 0) {
        Toast.notify({ type: 'error', message: 'At least one option requied' })
        return
      }
      const obj: Record<string, boolean> = {}
      let hasRepeatedItem = false
      tempOptions.forEach(o => {
        if (obj[o]) {
          hasRepeatedItem = true
          return
        }
        obj[o] = true
      })
      if (hasRepeatedItem) {
        Toast.notify({ type: 'error', message: 'Has repeat items' })
        return
      }
      onConfirm({ type: tempType, value: tempOptions })
    }
  }

  return (
    <Modal
      title={t('appDebug.variableConig.modalTitle')}
      isShow={isShow}
      onClose={onClose}
    >
      <div className='mb-8'>
        <div className='mt-2 mb-8 text-sm text-gray-500'>{t('appDebug.variableConig.description', { varName: `{{${name || key}}}` })}</div>
        <div className='mb-2'>
          <div className={s.title}>{t('appDebug.variableConig.fieldType')}</div>
          <div className='flex space-x-2'>
            <SelectTypeItem type='string' selected={isStringInput} onClick={handleTypeChange('string')} />
            <SelectTypeItem type='select' selected={!isStringInput} onClick={handleTypeChange('select')} />
          </div>
        </div>

        <div className='mt-6'>
          <div className={s.title}>{title}</div>
          {isStringInput ? (
            <ConfigString value={tempMaxLength} onChange={setTempMaxValue} />
          ) : (
            <ConfigSelect options={tempOptions} onChange={setTempOptions} />
          )}
        </div>

      </div>
      <ModalFoot
        onConfirm={handleConfirm}
        onCancel={onClose}
      />
    </Modal>
  )
}
export default React.memo(ConfigModal)
