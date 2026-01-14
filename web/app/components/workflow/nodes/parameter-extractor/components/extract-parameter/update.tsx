'use client'
import type { FC } from 'react'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'
import Button from '@/app/components/base/button'
import AddButton from '@/app/components/base/button/add-button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { ChangeType } from '@/app/components/workflow/types'
import { checkKeys } from '@/utils/var'
import { ParamType } from '../../types'

const i18nPrefix = 'nodes.parameterExtractor'
const errorI18nPrefix = 'errorMsg'

const DEFAULT_PARAM: Param = {
  name: '',
  type: ParamType.string,
  description: '',
  required: false,
}

type Props = {
  type: 'add' | 'edit'
  payload?: Param
  onSave: (payload: Param, moreInfo?: MoreInfo) => void
  onCancel?: () => void
}

const TYPES = [ParamType.string, ParamType.number, ParamType.bool, ParamType.arrayString, ParamType.arrayNumber, ParamType.arrayObject, ParamType.arrayBool]

const AddExtractParameter: FC<Props> = ({
  type,
  payload,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation()
  const isAdd = type === 'add'
  const [param, setParam] = useState<Param>(isAdd ? DEFAULT_PARAM : payload as Param)
  const [renameInfo, setRenameInfo] = useState<MoreInfo | undefined>(undefined)
  const handleParamChange = useCallback((key: string) => {
    return (value: any) => {
      if (key === 'name') {
        const { isValid, errorKey, errorMessageKey } = checkKeys([value], true)
        if (!isValid) {
          Toast.notify({
            type: 'error',
            message: t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: errorKey }),
          })
          return
        }
      }
      setRenameInfo(key === 'name'
        ? {
            type: ChangeType.changeVarName,
            payload: {
              beforeKey: param.name,
              afterKey: value,
            },
          }
        : undefined)
      setParam((prev) => {
        return {
          ...prev,
          [key]: value,
        }
      })
    }
  }, [param.name, t])

  const [isShowModal, {
    setTrue: doShowModal,
    setFalse: doHideModal,
  }] = useBoolean(!isAdd)

  const hideModal = useCallback(() => {
    doHideModal()
    onCancel?.()
  }, [onCancel, doHideModal])

  const showAddModal = useCallback(() => {
    if (isAdd)
      setParam(DEFAULT_PARAM)

    doShowModal()
  }, [isAdd, doShowModal])

  const checkValid = useCallback(() => {
    let errMessage = ''
    if (!param.name)
      errMessage = t(`${errorI18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.addExtractParameterContent.name`, { ns: 'workflow' }) })
    if (!errMessage && param.type === ParamType.select && (!param.options || param.options.length === 0))
      errMessage = t(`${errorI18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('variableConfig.options', { ns: 'appDebug' }) })
    if (!errMessage && !param.description)
      errMessage = t(`${errorI18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.addExtractParameterContent.description`, { ns: 'workflow' }) })

    if (errMessage) {
      Toast.notify({
        type: 'error',
        message: errMessage,
      })
      return false
    }
    return true
  }, [param, t])

  const handleSave = useCallback(() => {
    if (!checkValid())
      return

    onSave(param, renameInfo)
    hideModal()
  }, [checkValid, onSave, param, hideModal, renameInfo])

  return (
    <div>
      {isAdd && (
        <AddButton className="mx-1" onClick={showAddModal} />
      )}
      {isShowModal && (
        <Modal
          title={t(`${i18nPrefix}.addExtractParameter`, { ns: 'workflow' })}
          isShow
          onClose={hideModal}
          className="!w-[400px] !max-w-[400px] !p-4"
        >
          <div>
            <div className="space-y-2">
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.name`, { ns: 'workflow' })}>
                <Input
                  value={param.name}
                  onChange={e => handleParamChange('name')(e.target.value)}
                  placeholder={t(`${i18nPrefix}.addExtractParameterContent.namePlaceholder`, { ns: 'workflow' })!}
                />
              </Field>
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.type`, { ns: 'workflow' })}>
                <Select
                  defaultValue={param.type}
                  allowSearch={false}
                  // bgClassName='bg-gray-100'
                  onSelect={v => handleParamChange('type')(v.value)}
                  optionClassName="capitalize"
                  items={
                    TYPES.map(type => ({
                      value: type,
                      name: type,
                    }))
                  }
                />
              </Field>
              {param.type === ParamType.select && (
                <Field title={t('variableConfig.options', { ns: 'appDebug' })}>
                  <ConfigSelect options={param.options || []} onChange={handleParamChange('options')} />
                </Field>
              )}
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.description`, { ns: 'workflow' })}>
                <Textarea
                  value={param.description}
                  onChange={e => handleParamChange('description')(e.target.value)}
                  placeholder={t(`${i18nPrefix}.addExtractParameterContent.descriptionPlaceholder`, { ns: 'workflow' })!}
                />
              </Field>
              <Field title={t(`${i18nPrefix}.addExtractParameterContent.required`, { ns: 'workflow' })}>
                <>
                  <div className="mb-1.5 text-xs font-normal leading-[18px] text-text-tertiary">{t(`${i18nPrefix}.addExtractParameterContent.requiredContent`, { ns: 'workflow' })}</div>
                  <Switch size="l" defaultValue={param.required} onChange={handleParamChange('required')} />
                </>
              </Field>
            </div>
            <div className="mt-4 flex justify-end space-x-2">
              <Button className="!w-[95px]" onClick={hideModal}>{t('operation.cancel', { ns: 'common' })}</Button>
              <Button className="!w-[95px]" variant="primary" onClick={handleSave}>{isAdd ? t('operation.add', { ns: 'common' }) : t('operation.save', { ns: 'common' })}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
export default React.memo(AddExtractParameter)
