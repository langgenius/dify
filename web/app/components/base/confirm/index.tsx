import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../button'

export type IConfirm = {
  className?: string
  isShow: boolean
  onClose: () => void
  type?: 'info' | 'warning'
  isLoading?: boolean
  isDisabled?: boolean
  title: string
  content?: string
  confirmText?: string
  onConfirm: () => void
  cancelText?: string
  onCancel: () => void
  twoButton?: boolean
  children?: React.ReactNode
}

export default function Confirm({
  isShow,
  onClose,
  type = 'warning',
  twoButton = true,
  isLoading = false,
  isDisabled = false,
  title,
  content,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  children,
}: IConfirm) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(isShow)

  const confirmTxt = confirmText || `${t('common.operation.confirm')}`
  const cancelTxt = cancelText || `${t('common.operation.cancel')}`

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleClickOutside = (event: MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(event.target as Node))
      onClose()
  }

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    if (isShow) {
      setIsVisible(true)
    }
    else {
      const timer = setTimeout(() => setIsVisible(false), 200) // 200ms is the duration of the fade-out animation
      return () => clearTimeout(timer)
    }
  }, [isShow])

  if (!isVisible)
    return null

  return (
    <div className={'fixed inset-0 flex items-center justify-center z-[100] bg-background-overlay'}>
      <div ref={dialogRef} className={'relative w-full max-w-[480px] overflow-hidden'}>
        <div className='flex flex-col items-start max-w-full rounded-2xl border-[0.5px] border-solid border-components-panel-border shadows-shadow-lg bg-components-panel-bg'>
          <div className='flex pt-6 pl-6 pr-6 pb-4 flex-col items-start gap-2 self-stretch'>
            <div className='title-2xl-semi-bold text-text-primary'>{title}</div>
            <div className='system-md-regular text-text-tertiary'>{content}</div>
            <div>{children}</div>
          </div>
          <div className='flex p-6 gap-2 justify-end items-start self-stretch'>
            {twoButton && <Button onClick={onCancel}>{cancelTxt}</Button>}
            <Button variant={type === 'info' ? 'primary' : 'warning'} loading={isLoading} disabled={isDisabled} onClick={onConfirm}>{confirmTxt}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
