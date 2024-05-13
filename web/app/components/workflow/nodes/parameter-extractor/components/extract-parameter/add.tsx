'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Param } from '../../types'
import { ParamType } from '../../types'
import AddButton from '@/app/components/base/button/add-button'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'

const i18nPrefix = 'workflow.nodes.parameterExtractor'
const inputClassName = 'w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'

type Props = {
  onAdd: (payload: Param) => void
}

const AddExtractParameter: FC<Props> = ({
  onAdd,
}) => {
  const { t } = useTranslation()

  const [param, setParam] = useState<Param>({
    name: '',
    type: ParamType.string,
    description: '',
  })

  const handleParamChange = useCallback((key: string) => {
    return (value: any) => {
      setParam((prev) => {
        return {
          ...prev,
          [key]: value,
        }
      })
    }
  }, [])

  const [isShowAddModal, {
    setTrue: showAddModal,
    setFalse: hideAddModal,
  }] = useBoolean(false)

  const checkValid = useCallback(() => {
    return true
  }, [])

  const handleAdd = useCallback(() => {
    if (!checkValid())
      return

    onAdd(param)
    hideAddModal()
  }, [checkValid, onAdd, param, hideAddModal])
  return (
    <div>
      <AddButton className='mx-1' onClick={showAddModal} />
      {isShowAddModal && (
        <Modal
          title={t(`${i18nPrefix}.addExtractParameter`)}
          isShow
          onClose={hideAddModal}
          className='!w-[400px] !max-w-[400px] !p-4'
          wrapperClassName='!z-[100]'
        >
          <div>
            <div className='space-y-2'>
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.name`)}>
                <input
                  type='text'
                  className={inputClassName}
                  value={param.name}
                  onChange={e => handleParamChange('name')(e.target.value)}
                  placeholder={t(`${i18nPrefix}.addExtractParameterContent.namePlaceholder`)!}
                />
              </Field>
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.type`)}>
                <Select
                  defaultValue={param.type}
                  allowSearch={false}
                  bgClassName='bg-gray-100'
                  onSelect={v => handleParamChange('type')(v.value)}
                  items={[
                    { value: ParamType.string, name: t(`${i18nPrefix}.dataType.string`) },
                    { value: ParamType.number, name: t(`${i18nPrefix}.dataType.number`) },
                    { value: ParamType.bool, name: t(`${i18nPrefix}.dataType.bool`) },
                    { value: ParamType.select, name: t(`${i18nPrefix}.dataType.select`) },
                  ]}
                />
              </Field>
              {/* TODO: Select Options */}
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.description`)}>
                <textarea
                  className={cn(inputClassName, '!h-[80px]')}
                  value={param.description}
                  onChange={e => handleParamChange('description')(e.target.value)}
                  placeholder={t(`${i18nPrefix}.addExtractParameterContent.descriptionPlaceholder`)!}
                />
              </Field>
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.required`)}>
                <>
                  <div className='mb-1.5 leading-[18px] text-xs font-normal text-gray-500'>{t(`${i18nPrefix}.addExtractParameterContent.requiredContent`)}</div>
                  <Switch size='md' defaultValue={param.required} onChange={handleParamChange('required')} />
                </>
              </Field>
            </div>
            <div className='mt-4 flex justify-end space-x-2'>
              <Button className='flex !h-8 !w-[95px] text-[13px] font-medium text-gray-700' onClick={hideAddModal} >{t('common.operation.cancel')}</Button>
              <Button className='flex !h-8 !w-[95px] text-[13px] font-medium' type='primary' onClick={handleAdd}>{t('common.operation.add')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
export default React.memo(AddExtractParameter)
