import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  RiExternalLinkLine,
} from '@remixicon/react'
import Button from '@/app/components/base/button'

export type IConfirm = {
  className?: string
  isShow: boolean
  title: string
  content?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
  maskClosable?: boolean
  email?: string
  showLink?: boolean
}

function Confirm({
  isShow,
  title,
  content,
  onConfirm,
  onCancel,
  maskClosable = true,
  showLink,
  email,
}: IConfirm) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(isShow)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  const handleClickOutside = (event: MouseEvent) => {
    if (maskClosable && dialogRef.current && !dialogRef.current.contains(event.target as Node))
      onCancel()
  }

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [maskClosable])

  useEffect(() => {
    if (isShow) {
      setIsVisible(true)
    }
    else {
      const timer = setTimeout(() => setIsVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isShow])

  if (!isVisible)
    return null

  return createPortal(
    <div className={'fixed inset-0 flex items-center justify-center z-[10000000] bg-background-overlay'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div ref={dialogRef} className={'relative w-full max-w-[481px] overflow-hidden'}>
        <div className='flex flex-col items-start max-w-full rounded-2xl border-[0.5px] border-solid border-components-panel-border shadows-shadow-lg bg-components-panel-bg'>
          <div className='flex pt-6 pl-6 pr-6 pb-4 flex-col items-start gap-2 self-stretch'>
            <div className='title-2xl-semi-bold text-text-primary'>{title}</div>
            <div className='system-md-regular text-text-tertiary w-full'>{content}</div>
          </div>
          {email && (
            <div className='px-6 py-3 space-y-1 w-full'>
              <div className='text-text-secondary system-sm-semibold py-1'>{t('education.emailLabel')}</div>
              <div className='px-3 py-2 bg-components-input-bg-disabled rounded-lg text-components-input-text-filled-disabled system-sm-regular'>{email}</div>
            </div>
          )}
          <div className='flex p-6 gap-2 justify-between items-center self-stretch'>
            <div className='flex items-center gap-1'>
              {showLink && (
                <>
                  <a href='' className='text-text-accent system-xs-regular cursor-pointer'>{t('education.learn')}</a>
                  <RiExternalLinkLine className='w-3 h-3 text-text-accent' />
                </>
              )}
            </div>
            <Button variant='primary' className='!w-20' onClick={onConfirm}>{t('common.operation.ok')}</Button>
          </div>
        </div>
      </div>
    </div>, document.body,
  )
}

export default React.memo(Confirm)
