import { Button } from '@langgenius/dify-ui/button'
import {
  RiExternalLinkLine,
} from '@remixicon/react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type IConfirm = {
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
  const docLink = useDocLink()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(isShow)
  const eduDocLink = docLink('/use-dify/workspace/subscription-management#dify-for-education')

  const handleClick = () => {
    window.open(eduDocLink, '_blank', 'noopener,noreferrer')
  }

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
    <div
      className="fixed inset-0 z-10000000 flex items-center justify-center bg-background-overlay"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div ref={dialogRef} className="relative w-full max-w-[481px] overflow-hidden">
        <div className="shadows-shadow-lg flex max-w-full flex-col items-start rounded-2xl border-[0.5px] border-solid border-components-panel-border bg-components-panel-bg">
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <div className="title-2xl-semi-bold text-text-primary">{title}</div>
            <div className="w-full system-md-regular text-text-tertiary">{content}</div>
          </div>
          {email && (
            <div className="w-full space-y-1 px-6 py-3">
              <div className="py-1 system-sm-semibold text-text-secondary">{t('emailLabel', { ns: 'education' })}</div>
              <div className="rounded-lg bg-components-input-bg-disabled px-3 py-2 system-sm-regular text-components-input-text-filled-disabled">{email}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 self-stretch p-6">
            <div className="flex items-center gap-1">
              {showLink && (
                <>
                  <a onClick={handleClick} href={eduDocLink} target="_blank" rel="noopener noreferrer" className="cursor-pointer system-xs-regular text-text-accent">{t('learn', { ns: 'education' })}</a>
                  <RiExternalLinkLine className="h-3 w-3 text-text-accent" />
                </>
              )}
            </div>
            <Button variant="primary" className="w-20!" onClick={onConfirm}>{t('operation.ok', { ns: 'common' })}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default React.memo(Confirm)
