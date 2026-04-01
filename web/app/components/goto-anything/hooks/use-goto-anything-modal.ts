'use client'

import type { RefObject } from 'react'
import { useKeyPress } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getKeyboardKeyCodeBySystem, isEventTargetInputArea } from '@/app/components/workflow/utils/common'

export type UseGotoAnythingModalReturn = {
  show: boolean
  setShow: (show: boolean | ((prev: boolean) => boolean)) => void
  inputRef: RefObject<HTMLInputElement | null>
  handleClose: () => void
}

export const useGotoAnythingModal = (): UseGotoAnythingModalReturn => {
  const [show, setShow] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handle keyboard shortcuts
  const handleToggleModal = useCallback((e: KeyboardEvent) => {
    // Allow closing when modal is open, even if focus is in the search input
    if (!show && isEventTargetInputArea(e.target as HTMLElement))
      return
    e.preventDefault()
    setShow(prev => !prev)
  }, [show])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.k`, handleToggleModal, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(['esc'], (e) => {
    if (show) {
      e.preventDefault()
      setShow(false)
    }
  })

  const handleClose = useCallback(() => {
    setShow(false)
  }, [])

  // Focus input when modal opens
  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [show])

  return {
    show,
    setShow,
    inputRef,
    handleClose,
  }
}
