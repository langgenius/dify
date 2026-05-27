'use client'

import type { RefObject } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useRef, useState } from 'react'

type UseGotoAnythingModalReturn = {
  show: boolean
  setShow: (show: boolean | ((prev: boolean) => boolean)) => void
  inputRef: RefObject<HTMLInputElement | null>
  handleClose: () => void
}

export const GOTO_ANYTHING_OPEN_EVENT = 'dify:goto-anything-open'

export const useGotoAnythingModal = (): UseGotoAnythingModalReturn => {
  const [show, setShow] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handle keyboard shortcuts
  const handleToggleModal = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    setShow(prev => !prev)
  }, [])

  useHotkey('Mod+K', handleToggleModal, {
    ignoreInputs: !show,
  })

  useHotkey('Escape', (e) => {
    e.preventDefault()
    setShow(false)
  }, {
    enabled: show,
    ignoreInputs: false,
  })

  useEffect(() => {
    const handleOpen = () => setShow(true)

    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  }, [])

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
