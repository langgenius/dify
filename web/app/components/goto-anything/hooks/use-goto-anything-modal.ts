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

export const useGotoAnythingModal = (): UseGotoAnythingModalReturn => {
  const open = useGotoAnythingOpen()
  const setOpen = useSetGotoAnythingOpen()
  const inputRef = useRef<HTMLInputElement>(null)

  useHotkey(
    'Mod+K',
    (e) => {
      e.preventDefault()
      setOpen((prev) => !prev)
    },
    {
      ignoreInputs: !open,
    },
  )

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
