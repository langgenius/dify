'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import useSWR, { useSWRConfig } from 'swr'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { debounce } from 'lodash-es'
import Popover from '@/app/components/base/popover'
import Button from '@/app/components/base/button'
import Tag from '@/app/components/base/tag'
import { ToastContext } from '@/app/components/base/toast'
import { updateOpenAIKey, validateOpenAIKey } from '@/service/apps'
import { fetchTenantInfo } from '@/service/common'
import I18n from '@/context/i18n'

type IStatusType = 'normal' | 'verified' | 'error' | 'error-api-key-exceed-bill'

const STATUS_COLOR_MAP = {
  normal: { color: '', bgColor: 'bg-primary-50', borderColor: 'border-primary-100' },
  error: { color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-100' },
  verified: { color: '', bgColor: 'bg-green-50', borderColor: 'border-green-100' },
  'error-api-key-exceed-bill': { color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-100' },
}

const CheckCircleIcon: FC<{ className?: string }> = ({ className }) => {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <rect width="20" height="20" rx="10" fill="#DEF7EC" />
    <path fill-rule="evenodd" clip-rule="evenodd" d="M14.6947 6.70495C14.8259 6.83622 14.8996 7.01424 14.8996 7.19985C14.8996 7.38547 14.8259 7.56348 14.6947 7.69475L9.0947 13.2948C8.96343 13.426 8.78541 13.4997 8.5998 13.4997C8.41418 13.4997 8.23617 13.426 8.1049 13.2948L5.3049 10.4948C5.17739 10.3627 5.10683 10.1859 5.10842 10.0024C5.11002 9.81883 5.18364 9.64326 5.31342 9.51348C5.44321 9.38369 5.61878 9.31007 5.80232 9.30848C5.98585 9.30688 6.16268 9.37744 6.2947 9.50495L8.5998 11.8101L13.7049 6.70495C13.8362 6.57372 14.0142 6.5 14.1998 6.5C14.3854 6.5 14.5634 6.57372 14.6947 6.70495Z" fill="#046C4E" />
  </svg>
}

type IEditKeyDiv = {
  className?: string
  showInPopover?: boolean
  onClose?: () => void
  getTenantInfo?: () => void
}

const EditKeyDiv: FC<IEditKeyDiv> = ({ className = '', showInPopover = false, onClose, getTenantInfo }) => {
  const [inputValue, setInputValue] = useState<string | undefined>()
  const [editStatus, setEditStatus] = useState<IStatusType>('normal')
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  // Hide the pop-up window and need to get the latest key again
  // If the key is valid, the edit button will be hidden later
  const onClosePanel = () => {
    getTenantInfo && getTenantInfo()
    onClose && onClose()
  }

  const onSaveKey = async () => {
    if (editStatus === 'verified') {
      setLoading(true)
      try {
        await updateOpenAIKey({ url: '/providers/openai/token', body: { token: inputValue ?? '' } })
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onClosePanel()
      }
      catch (err) {
        notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
      }
      finally {
        setLoading(false)
      }
    }
  }

  const validateKey = async (value: string) => {
    try {
      setValidating(true)
      const res = await validateOpenAIKey({ url: '/providers/openai/token-validate', body: { token: value ?? '' } })
      setEditStatus(res.result === 'success' ? 'verified' : 'error')
    }
    catch (err: any) {
      if (err.status === 400) {
        err.json().then(({ code }: any) => {
          if (code === 'provider_request_failed') {
            setEditStatus('error-api-key-exceed-bill')
          }
        })
      } else {
        setEditStatus('error')
      }
    }
    finally {
      setValidating(false)
    }
  }
  const renderErrorMessage = () => {
    if (validating) {
      return (
        <div className={`text-primary-600 mt-2 text-xs`}>
          {t('common.provider.validating')}
        </div>
      )
    }
    if (editStatus === 'error-api-key-exceed-bill') {
      return (
        <div className={`text-[#D92D20] mt-2 text-xs`}>
          {t('common.provider.apiKeyExceedBill')}
          {locale === 'en' ? ' ' : ''}
          <Link 
            className='underline'
            href="https://platform.openai.com/account/api-keys" 
            target={'_blank'}>
            {locale === 'en' ? 'this link' : '这篇文档'}
          </Link>
        </div>
      )
    }
    if (editStatus === 'error') {
      return (
        <div className={`text-[#D92D20] mt-2 text-xs`}>
          {t('common.provider.invalidKey')}
        </div>
      )
    }
    return null
  }

  return (
    <div className={`flex flex-col w-full rounded-lg px-8 py-6 border-solid border-[0.5px] ${className} ${Object.values(STATUS_COLOR_MAP[editStatus]).join(' ')}`}>
      {!showInPopover && <p className='text-xl font-medium text-gray-800'>{t('appOverview.welcome.firstStepTip')}</p>}
      <p className={`${showInPopover ? 'text-sm' : 'text-xl'} font-medium text-gray-800`}>{t('appOverview.welcome.enterKeyTip')} {showInPopover ? '' : '👇'}</p>
      <div className='relative mt-2'>
        <input type="text"
          className={`h-9 w-96 max-w-full py-2 pl-2 text-gray-900 rounded-lg bg-white sm:text-xs focus:ring-blue-500 focus:border-blue-500 shadow-sm ${editStatus === 'normal' ? 'pr-2' : 'pr-8'}`}
          placeholder={t('appOverview.welcome.placeholder') || ''}
          onChange={debounce((e) => {
            setInputValue(e.target.value)
            if (!e.target.value) {
              setEditStatus('normal')
              return
            }
            validateKey(e.target.value)
          }, 300)}
        />
        {editStatus === 'verified' && <div className="absolute inset-y-0 right-0 flex flex-row-reverse items-center pr-6 pointer-events-none">
          <CheckCircleIcon className="rounded-lg" />
        </div>}
        {(editStatus === 'error' || editStatus === 'error-api-key-exceed-bill') && <div className="absolute inset-y-0 right-0 flex flex-row-reverse items-center pr-6 pointer-events-none">
          <ExclamationCircleIcon className="w-5 h-5 text-red-800" />
        </div>}
        {showInPopover ? null : <Button type='primary' onClick={onSaveKey} className='!h-9 !inline-block ml-2' loading={loading} disabled={editStatus !== 'verified'}>{t('common.operation.save')}</Button>}
      </div>
      {renderErrorMessage()}
      <Link className="inline-flex items-center mt-2 text-xs font-normal cursor-pointer text-primary-600 w-fit" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
        {t('appOverview.welcome.getKeyTip')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
      {showInPopover && <div className='flex justify-end mt-6'>
        <Button className='flex-shrink-0 mr-2' onClick={onClosePanel}>{t('common.operation.cancel')}</Button>
        <Button type='primary' className='flex-shrink-0' onClick={onSaveKey} loading={loading} disabled={editStatus !== 'verified'}>{t('common.operation.save')}</Button>
      </div>}
    </div>
  )
}

const WelcomeBanner: FC = () => {
  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  if (!userInfo)
    return null
  return userInfo?.providers?.find(({ token_is_set }) => token_is_set) ? null : <EditKeyDiv className='mb-8' />
}

export const EditKeyPopover: FC = () => {
  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  const { mutate } = useSWRConfig()
  if (!userInfo)
    return null

  const getTenantInfo = () => {
    mutate({ url: '/info' })
  }
  // In this case, the edit button is displayed
  const targetProvider = userInfo?.providers?.some(({ token_is_set, is_valid }) => token_is_set && is_valid)
  return (
    !targetProvider
      ? <div className='flex items-center'>
        <Tag className='mr-2 h-fit' color='red'><ExclamationCircleIcon className='h-3.5 w-3.5 mr-2' />OpenAI API key invalid</Tag>
        <Popover
          htmlContent={<EditKeyDiv className='!border-0' showInPopover={true} getTenantInfo={getTenantInfo} />}
          trigger='click'
          position='br'
          btnElement='Edit'
          btnClassName='text-primary-600 !text-xs px-3 py-1.5'
          className='!p-0 !w-[464px] h-[200px]'
        />
      </div>
      : null)
}

export default WelcomeBanner
