'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback } from 'react'
import produce from 'immer'
import type { Authorization as AuthorizationPayloadType } from '../../types'
import { APIType, AuthorizationType } from '../../types'
import RadioGroup from './radio-group'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

const i18nPrefix = 'workflow.nodes.http.authorization'

type Props = {
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
  payload,
  onChange,
  isShow,
  onHide,
}) => {
  const { t } = useTranslation()

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
                  <input
                    type='text'
                    className='w-full h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
                    value={tempPayload.config?.header || ''}
                    onChange={handleAPIKeyOrHeaderChange('header')}
                  />
                </Field>
              )}

              <Field title={t(`${i18nPrefix}.api-key-title`)} isRequired>
                <input
                  type='text'
                  className='w-full h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
                  value={tempPayload.config?.api_key || ''}
                  onChange={handleAPIKeyOrHeaderChange('api_key')}
                />
              </Field>
            </>
          )}
        </div>
        <div className='mt-6 flex justify-end space-x-2'>
          <Button onClick={onHide} className='flex items-center !h-8 leading-[18px] !text-[13px] !font-medium'>{t('common.operation.cancel')}</Button>
          <Button type='primary' onClick={handleConfirm} className='flex items-center !h-8 leading-[18px] !text-[13px] !font-medium'>{t('common.operation.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(Authorization)
