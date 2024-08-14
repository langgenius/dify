import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Button from '../button'

export type IConfirm = {
  className?: string
  isShow: boolean
  type?: 'info' | 'warning'
  title: string
  content?: React.ReactNode
  confirmText?: string | null
  onConfirm: () => void
  cancelText?: string
  onCancel: () => void
  isLoading?: boolean
  isDisabled?: boolean
  showConfirm?: boolean
  showCancel?: boolean
  maskClosable?: boolean
}

function Confirm({
  isShow,
  type = 'warning',
  title,
  content,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  showConfirm = true,
  showCancel = true,
  isLoading = false,
  isDisabled = false,
  maskClosable = true,
}: IConfirm) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(isShow)

  const confirmTxt = confirmText || `${t('common.operation.confirm')}`
  const cancelTxt = cancelText || `${t('common.operation.cancel')}`

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
      }}>
      <div ref={dialogRef} className={'relative w-full max-w-[480px] overflow-hidden'}>
        <div className='flex flex-col items-start max-w-full rounded-2xl border-[0.5px] border-solid border-components-panel-border shadows-shadow-lg bg-components-panel-bg'>
          <div className='flex pt-6 pl-6 pr-6 pb-4 flex-col items-start gap-2 self-stretch'>
            <div className='title-2xl-semi-bold text-text-primary'>{title}</div>
            <div className='system-md-regular text-text-tertiary w-full'>{content}</div>
          </div>
          <div className='flex p-6 gap-2 justify-end items-start self-stretch'>
            {showCancel && <Button onClick={onCancel}>{cancelTxt}</Button>}
            {showConfirm && <Button variant={'primary'} destructive={type !== 'info'} loading={isLoading} disabled={isDisabled} onClick={onConfirm}>{confirmTxt}</Button>}
          </div>
        </div>
      </div>
    </div>, document.body,
  )
}

export default React.memo(Confirm)
