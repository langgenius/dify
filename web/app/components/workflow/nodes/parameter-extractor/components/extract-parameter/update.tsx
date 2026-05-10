'use client'
import type { FC } from 'react'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
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
          toast.error(t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: errorKey }))
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
      toast.error(errMessage)
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
        <div className="mx-1 cursor-pointer rounded-md p-1 select-none hover:bg-state-base-hover" onClick={showAddModal} data-testid="add-button">
          <span className="i-ri-add-line h-4 w-4 text-text-tertiary" />
        </div>
      )}
      {isShowModal && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open)
              hideModal()
          }}
        >
          <DialogContent className="w-[400px]! max-w-[400px]! overflow-hidden! border-none p-4! text-left align-middle">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(`${i18nPrefix}.addExtractParameter`, { ns: 'workflow' })}
            </DialogTitle>

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
                    value={param.type}
                    onValueChange={value => value && handleParamChange('type')(value)}
                  >
                    <SelectTrigger className="w-full capitalize">
                      {param.type}
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map(type => (
                        <SelectItem key={type} value={type} className="capitalize">
                          <SelectItemText className="capitalize">{type}</SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <div className="mb-1.5 text-xs leading-[18px] font-normal text-text-tertiary">{t(`${i18nPrefix}.addExtractParameterContent.requiredContent`, { ns: 'workflow' })}</div>
                    <Switch size="lg" checked={param.required ?? false} onCheckedChange={handleParamChange('required')} />
                  </>
                </Field>
              </div>
              <div className="mt-4 flex justify-end space-x-2">
                <Button className="w-[95px]!" onClick={hideModal}>{t('operation.cancel', { ns: 'common' })}</Button>
                <Button className="w-[95px]!" variant="primary" onClick={handleSave}>{isAdd ? t('operation.add', { ns: 'common' }) : t('operation.save', { ns: 'common' })}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
export default React.memo(AddExtractParameter)
