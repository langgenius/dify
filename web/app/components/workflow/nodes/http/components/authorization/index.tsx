'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import type { Authorization as AuthorizationPayloadType } from '../../types'
import { APIType, AuthorizationType } from '../../types'
import RadioGroup from './radio-group'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
type Props = {
  payload: AuthorizationPayloadType
  onChange: (newPayload: AuthorizationPayloadType) => void
  isShow: boolean
  onHide: () => void
}

const Field = ({ title, children }: { title: string; children: JSX.Element }) => {
  return (
    <div>
      <div className='leading-8 text-[13px] font-medium text-gray-700'>{title}</div>
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
      title='Authorization'
      wrapperClassName='z-50 w-400'
      isShow={isShow}
      onClose={onHide}
    >
      <div>
        <div className='space-y-2'>
          <Field title='Type'>
            <RadioGroup
              options={[
                { value: AuthorizationType.none, label: 'Basic' },
                { value: AuthorizationType.apiKey, label: 'Bearer' },
              ]}
              value={tempPayload.type}
              onChange={handleAuthTypeChange}
            />
          </Field>

          {tempPayload.type === AuthorizationType.apiKey && (
            <>
              <Field title='Auth type'>
                <RadioGroup
                  options={[
                    { value: APIType.basic, label: 'Basic' },
                    { value: APIType.bearer, label: 'Bearer' },
                    { value: APIType.custom, label: 'Custom' },
                  ]}
                  value={tempPayload.config?.type || APIType.basic}
                  onChange={handleAuthAPITypeChange}
                />
              </Field>
              {tempPayload.config?.type === APIType.custom && (
                <Field title='header'>
                  <input
                    type='text'
                    className='w-full h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
                    value={tempPayload.config?.header || ''}
                    onChange={handleAPIKeyOrHeaderChange('header')}
                  />
                </Field>
              )}

              <Field title='API Key'>
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
          <Button onClick={onHide} className='flex items-center !h-8 leading-[18px] !text-[13px] !font-medium'>Cancel</Button>
          <Button type='primary' onClick={handleConfirm} className='flex items-center !h-8 leading-[18px] !text-[13px] !font-medium'>Confirm</Button>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(Authorization)
