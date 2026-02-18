'use client'
import type { SuccessInvitationResult } from '.'
import copy from 'copy-to-clipboard'
import { t } from 'i18next'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import s from './index.module.css'

type IInvitationLinkProps = {
  value: SuccessInvitationResult
}

const InvitationLink = ({
  value,
}: IInvitationLinkProps) => {
  const [isCopied, setIsCopied] = useState(false)

  const copyHandle = useCallback(() => {
    // No prefix is needed here because the backend has already processed it
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
    <div className="flex items-center rounded-lg border border-components-input-border-active bg-components-input-bg-normal py-2 hover:bg-state-base-hover">
      <div className="flex h-5 grow items-center">
        <div className="relative h-full grow text-[13px]">
          <Tooltip
            popupContent={isCopied ? `${t('copied', { ns: 'appApi' })}` : `${t('copy', { ns: 'appApi' })}`}
          >
            <div className="r-0 absolute left-0 top-0 w-full cursor-pointer truncate pl-2 pr-2 text-text-primary" onClick={copyHandle}>{value.url}</div>
          </Tooltip>
        </div>
        <div className="h-4 shrink-0 border bg-divider-regular" />
        <Tooltip
          popupContent={isCopied ? `${t('copied', { ns: 'appApi' })}` : `${t('copy', { ns: 'appApi' })}`}
        >
          <div className="shrink-0 px-0.5">
            <div className={`box-border flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover ${s.copyIcon} ${isCopied ? s.copied : ''}`} onClick={copyHandle}>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default InvitationLink
