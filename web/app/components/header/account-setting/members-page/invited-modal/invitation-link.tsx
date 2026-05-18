'use client'
import type { SuccessInvitationResult } from '.'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'

type IInvitationLinkProps = {
  value: SuccessInvitationResult
}

const InvitationLink = ({
  value,
}: IInvitationLinkProps) => {
  const { t } = useTranslation()
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
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  className="absolute top-0 right-0 left-0 block w-full cursor-pointer truncate border-none bg-transparent p-0 pr-2 pl-2 text-left text-text-primary"
                  onClick={copyHandle}
                >
                  {value.url}
                </button>
              )}
            />
            <TooltipContent>
              {isCopied ? t('copied', { ns: 'appApi' }) : t('copy', { ns: 'appApi' })}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="h-4 shrink-0 border border-divider-regular bg-divider-regular" />
        <Tooltip>
          <TooltipTrigger
            render={(
              <div className="shrink-0 px-0.5">
                <button
                  type="button"
                  aria-label={t('copy', { ns: 'appApi' })}
                  className={`box-border flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 hover:bg-state-base-hover ${s.copyIcon} ${isCopied ? s.copied : ''}`}
                  onClick={copyHandle}
                />
              </div>
            )}
          />
          <TooltipContent>
            {isCopied ? t('copied', { ns: 'appApi' }) : t('copy', { ns: 'appApi' })}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export default InvitationLink
