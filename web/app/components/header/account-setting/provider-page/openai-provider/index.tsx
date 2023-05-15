import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowTopRightOnSquareIcon, PencilIcon } from '@heroicons/react/24/outline'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import Button from '@/app/components/base/button'
import s from './index.module.css'
import classNames from 'classnames'
import { fetchTenantInfo, validateProviderKey, updateProviderAIKey } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
import Indicator from '../../../indicator'
import I18n from '@/context/i18n'

type IStatusType = 'normal' | 'verified' | 'error' | 'error-api-key-exceed-bill'

type TInputWithStatusProps = {
  value: string
  onChange: (v: string) => void
  onValidating: (validating: boolean) => void
  verifiedStatus: IStatusType
  onVerified: (verified: IStatusType) => void
}
const InputWithStatus = ({
  value,
  onChange,
  onValidating,
  verifiedStatus,
  onVerified
}: TInputWithStatusProps) => {
  const { t } = useTranslation()
  const validateKey = useRef(debounce(async (token: string) => {
    if (!token) return
    onValidating(true)
    try {
      const res = await validateProviderKey({ url: '/workspaces/current/providers/openai/token-validate', body: { token } })
      onVerified(res.result === 'success' ? 'verified' : 'error')
    } catch (e: any) {
      if (e.status === 400) {
        e.json().then(({ code }: any) => {
          if (code === 'provider_request_failed') {
            onVerified('error-api-key-exceed-bill')
          }
        })
      } else {
        onVerified('error')
      }
    } finally {
      onValidating(false)
    }
  }, 500))
 
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    onChange(inputValue)
    if (!inputValue) {
      onVerified('normal')
    }
    validateKey.current(inputValue)
  }
  return (
    <div className={classNames('flex items-center h-9 px-3 bg-white border border-gray-300 rounded-lg', s.input)}>
      <input
        value={value}
        placeholder={t('common.provider.enterYourKey') || ''}
        className='w-full h-9 mr-2 appearance-none outline-none bg-transparent text-xs'
        onChange={handleChange} 
      />
      {
        verifiedStatus === 'error' && <ExclamationCircleIcon className='w-4 h-4 text-[#D92D20]' />
      }
      {
        verifiedStatus === 'verified' && <CheckCircleIcon className='w-4 h-4 text-[#039855]' />
      }
    </div>
  )
}

const OpenaiProvider = () => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const { data: userInfo, mutate } = useSWR({ url: '/info' }, fetchTenantInfo)
  const [inputValue, setInputValue] = useState<string>('')
  const [validating, setValidating] = useState(false)
  const [editStatus, setEditStatus] = useState<IStatusType>('normal')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [invalidStatus, setInvalidStatus] = useState(false)
  const { notify } = useContext(ToastContext)
  const provider = userInfo?.providers?.find(({ provider }) => provider === 'openai')
 
  const handleReset = () => {
    setInputValue('')
    setValidating(false)
    setEditStatus('normal')
    setLoading(false)
    setEditing(false)
  }
  const handleSave = async () => {
    if (editStatus === 'verified') {
      try {
        setLoading(true)
        await updateProviderAIKey({ url: '/workspaces/current/providers/openai/token', body: { token: inputValue ?? '' } })
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      } catch (e) {
        notify({ type: 'error', message: t('common.provider.saveFailed') })
      } finally {
        setLoading(false)
        handleReset()
        mutate()
      }
    }
  }
  useEffect(() => {
    if (provider && !provider.token_is_valid && provider.token_is_set) {
      setInvalidStatus(true)
    }
  }, [userInfo])

  const showInvalidStatus = invalidStatus && !editing
  const renderErrorMessage = () => {
    if (validating) {
      return (
        <div className={`mt-2 text-primary-600 text-xs font-normal`}>
          {t('common.provider.validating')}
        </div>
      )
    }
    if (editStatus === 'error-api-key-exceed-bill') {
      return (
        <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
          {t('common.provider.apiKeyExceedBill')}&nbsp;
          <Link 
            className='underline'
            href="https://platform.openai.com/account/api-keys" 
            target={'_blank'}>
            {locale === 'en' ? 'this link' : '这篇文档'}
          </Link>
        </div>
      )
    }
    if (showInvalidStatus || editStatus === 'error') {
      return (
        <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
          {t('common.provider.invalidKey')}
        </div>
      )
    }
    return null
  }

  return (
    <div className='px-4 pt-3 pb-4'>
        <div className='flex items-center mb-2 h-6'>
          <div className='grow text-[13px] text-gray-800 font-medium'>
            {t('common.provider.apiKey')} 
          </div>
          {
            provider && !editing && (
              <div 
                className='
                  flex items-center h-6 px-2 rounded-md border border-gray-200
                  text-xs font-medium text-gray-700 cursor-pointer
                '
                onClick={() => setEditing(true)}
              >
                <PencilIcon className='mr-1 w-3 h-3 text-gray-500' />
                {t('common.operation.edit')}
              </div>
            )
          }
          {
            (inputValue || editing) && (
              <>
                <Button 
                  className={classNames('mr-1', s.button)} 
                  loading={loading}
                  onClick={handleReset}
                >
                  {t('common.operation.cancel')}
                </Button>
                <Button 
                  type='primary' 
                  className={classNames(s.button)} 
                  loading={loading} 
                  onClick={handleSave}>
                  {t('common.operation.save')}
                </Button>
              </>
            )
          }
        </div>
        {
          (!provider || (provider && editing)) && (
            <InputWithStatus
              value={inputValue}
              onChange={v => setInputValue(v)}
              verifiedStatus={editStatus}
              onVerified={v => setEditStatus(v)}
              onValidating={v => setValidating(v)}
            />
          )
        }
        {
          (provider && !editing) && (
            <div className={classNames('flex justify-between items-center bg-white px-3 h-9 rounded-lg text-gray-800 text-xs font-medium', s.input)}>
              sk-0C...skuA
              <Indicator color={(provider.token_is_set && provider.token_is_valid) ? 'green' : 'orange'} />
            </div>
          )
        }
        {renderErrorMessage()}
        <Link className="inline-flex items-center mt-3 text-xs font-normal cursor-pointer text-primary-600 w-fit" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
          {t('appOverview.welcome.getKeyTip')}
          <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
        </Link>
      </div>
  )
}

export default OpenaiProvider