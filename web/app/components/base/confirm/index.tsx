import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Button from '../button'

export type IConfirm = {
  className?: string
  isShow: boolean
  type?: 'info' | 'warning' | 'danger'
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
      if (event.key === 'Enter' && isShow) {
        event.preventDefault()
        onConfirm()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel, onConfirm, isShow])

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
    <div className={'fixed inset-0 z-[10000000] flex items-center justify-center bg-background-overlay'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}>
      <div ref={dialogRef} className={'relative w-full max-w-[480px] overflow-hidden'}>
        <div className='shadows-shadow-lg flex max-w-full flex-col items-start rounded-2xl border-[0.5px] border-solid border-components-panel-border bg-components-panel-bg'>
          <div className='flex flex-col items-start gap-2 self-stretch pb-4 pl-6 pr-6 pt-6'>
            <div className='title-2xl-semi-bold text-text-primary'>{title}</div>
            <div className='system-md-regular w-full text-text-tertiary'>{content}</div>
          </div>
          <div className='flex items-start justify-end gap-2 self-stretch p-6'>
            {showCancel && <Button onClick={onCancel}>{cancelTxt}</Button>}
            {showConfirm && <Button variant={'primary'} destructive={type !== 'info'} loading={isLoading} disabled={isDisabled} onClick={onConfirm}>{confirmTxt}</Button>}
          </div>
        </div>
      </div>
    </div>, document.body,
  )
}

export default React.memo(Confirm)
