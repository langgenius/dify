'use client'

import type { RefObject } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useRef } from 'react'
import { useGotoAnythingOpen, useSetGotoAnythingOpen } from '../atoms'

type UseGotoAnythingModalReturn = {
  open: boolean
  onOpenChange: (open: boolean) => void
  inputRef: RefObject<HTMLInputElement | null>
}

export const GOTO_ANYTHING_OPEN_EVENT = 'dify:goto-anything-open'

export const useGotoAnythingModal = (): UseGotoAnythingModalReturn => {
  const open = useGotoAnythingOpen()
  const setOpen = useSetGotoAnythingOpen()
  const inputRef = useRef<HTMLInputElement>(null)

  useHotkey('Mod+K', (e) => {
    e.preventDefault()
    setOpen(prev => !prev)
  }, {
    ignoreInputs: !open,
  })

  useEffect(() => {
    const handleOpen = () => setOpen(true)

    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  }, [setOpen])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  return {
    open,
    onOpenChange: setOpen,
    inputRef,
  }
}
