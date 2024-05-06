'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import copy from 'copy-to-clipboard'
import s from './index.module.css'
import type { SuccessInvationResult } from '.'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'

type IInvitationLinkProps = {
  value: SuccessInvationResult
}

const InvitationLink = ({
  value,
}: IInvitationLinkProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const selector = useRef(`invite-link-${randomString(4)}`)

  const copyHandle = useCallback(() => {
    copy(`${!value.url.startsWith('http') ? window.location.origin : ''}${value.url}`)
    setIsCopied(true)
  }, [value])

  useEffect(() => {
    if (isCopied) {
      const timeout = setTimeout(() => {
        setIsCopied(false)
      }, 1000)

      return () => {
        clearTimeout(timeout)
      }
    }
  }, [isCopied])

  return (
    <div className='flex rounded-lg bg-gray-100 hover:bg-gray-100 border border-gray-200 py-2 items-center'>
      <div className="flex items-center flex-grow h-5">
        <div className='flex-grow bg-gray-100 text-[13px] relative h-full'>
          <Tooltip
            selector={selector.current}
            content={isCopied ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
            className='z-10'
          >
            <div className='absolute top-0 left-0 w-full pl-2 pr-2 truncate cursor-pointer r-0' onClick={copyHandle}>{value.url}</div>
          </Tooltip>
        </div>
        <div className="flex-shrink-0 h-4 bg-gray-200 border" />
        <Tooltip
          selector={selector.current}
          content={isCopied ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
          className='z-10'
        >
          <div className="px-0.5 flex-shrink-0">
            <div className={`box-border w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-gray-100 cursor-pointer ${s.copyIcon} ${isCopied ? s.copied : ''}`} onClick={copyHandle}>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default InvitationLink
