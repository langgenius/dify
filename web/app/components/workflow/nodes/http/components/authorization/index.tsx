'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback, useState } from 'react'
import produce from 'immer'
import type { Authorization as AuthorizationPayloadType } from '../../types'
import { APIType, AuthorizationType } from '../../types'
import RadioGroup from './radio-group'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import type { Var } from '@/app/components/workflow/types'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import BaseInput from '@/app/components/base/input'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.http.authorization'

type Props = {
  nodeId: string
  payload: AuthorizationPayloadType
  onChange: (payload: AuthorizationPayloadType) => void
  isShow: boolean
  onHide: () => void
}

const Field = ({ title, isRequired, children }: { title: string; isRequired?: boolean; children: JSX.Element }) => {
  return (
    <div>
      <div className='leading-8 text-[13px] font-medium text-gray-700'>
        {title}
        {isRequired && <span className='ml-0.5 text-[#D92D20]'>*</span>}
      </div>
      <div>{children}</div>
    </div>
  )
}

const Authorization: FC<Props> = ({
  nodeId,
  payload,
  onChange,
  isShow,
  onHide,
}) => {
  const { t } = useTranslation()

  const [isFocus, setIsFocus] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  const [tempPayload, setTempPayload] = React.useState<AuthorizationPayloadType>(payload)
  const handleAuthTypeChange = useCallback((type: string) => {
    const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
      draft.type = type as AuthorizationType
      if (draft.type === AuthorizationType.apiKey && !draft.config) {
        draft.config = {
          type: APIType.basic,
          api_key: '',
        }
      }
    })
    setTempPayload(newPayload)
  }, [tempPayload, setTempPayload])

  const handleAuthAPITypeChange = useCallback((type: string) => {
    const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
      if (!draft.config) {
        draft.config = {
          type: APIType.basic,
          api_key: '',
        }
      }
      draft.config.type = type as APIType
    })
    setTempPayload(newPayload)
  }, [tempPayload, setTempPayload])

  const handleAPIKeyOrHeaderChange = useCallback((type: 'api_key' | 'header') => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
        if (!draft.config) {
          draft.config = {
            type: APIType.basic,
            api_key: '',
          }
        }
        draft.config[type] = e.target.value
      })
      setTempPayload(newPayload)
    }
  }, [tempPayload, setTempPayload])

  const handleAPIKeyChange = useCallback((str: string) => {
    const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
      if (!draft.config) {
        draft.config = {
          type: APIType.basic,
          api_key: '',
        }
      }
      draft.config.api_key = str
    })
    setTempPayload(newPayload)
  }, [tempPayload, setTempPayload])

  const handleConfirm = useCallback(() => {
    onChange(tempPayload)
    onHide()
  }, [tempPayload, onChange, onHide])
  return (
    <Modal
      title={t(`${i18nPrefix}.authorization`)}
      isShow={isShow}
      onClose={onHide}
    >
      <div>
        <div className='space-y-2'>
          <Field title={t(`${i18nPrefix}.authorizationType`)}>
            <RadioGroup
              options={[
                { value: AuthorizationType.none, label: t(`${i18nPrefix}.no-auth`) },
                { value: AuthorizationType.apiKey, label: t(`${i18nPrefix}.api-key`) },
              ]}
              value={tempPayload.type}
              onChange={handleAuthTypeChange}
            />
          </Field>

          {tempPayload.type === AuthorizationType.apiKey && (
            <>
              <Field title={t(`${i18nPrefix}.auth-type`)}>
                <RadioGroup
                  options={[
                    { value: APIType.basic, label: t(`${i18nPrefix}.basic`) },
                    { value: APIType.bearer, label: t(`${i18nPrefix}.bearer`) },
                    { value: APIType.custom, label: t(`${i18nPrefix}.custom`) },
                  ]}
                  value={tempPayload.config?.type || APIType.basic}
                  onChange={handleAuthAPITypeChange}
                />
              </Field>
              {tempPayload.config?.type === APIType.custom && (
                <Field title={t(`${i18nPrefix}.header`)} isRequired>
                  <BaseInput
                    value={tempPayload.config?.header || ''}
                    onChange={handleAPIKeyOrHeaderChange('header')}
                  />
                </Field>
              )}

              <Field title={t(`${i18nPrefix}.api-key-title`)} isRequired>
                <div className='flex'>
                  <Input
                    instanceId='http-api-key'
                    className={cn(isFocus ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
                    value={tempPayload.config?.api_key || ''}
                    onChange={handleAPIKeyChange}
                    nodesOutputVars={availableVars}
                    availableNodes={availableNodesWithParent}
                    onFocusChange={setIsFocus}
                    placeholder={' '}
                    placeholderClassName='!leading-[21px]'
                  />
                </div>
              </Field>
            </>
          )}
        </div>
        <div className='mt-6 flex justify-end space-x-2'>
          <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleConfirm}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(Authorization)
