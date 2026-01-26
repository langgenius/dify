'use client'
import { useBoolean } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'

export type ModalStateResult = {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

/**
 * Simple hook for managing modal open/close state
 */
export const useModalState = (initialState = false): ModalStateResult => {
  const [isOpen, { setTrue: open, setFalse: close, toggle }] = useBoolean(initialState)
  return { isOpen, open, close, toggle }
}

type ModalActions = {
  isOpen: boolean
  open: () => void
  close: () => void
}

/**
 * Hook for managing multiple modal states
 * Uses a single useState to avoid violating Rules of Hooks
 */
export const useMultiModalState = <T extends string>(modalNames: T[]) => {
  // Use a single state object to track all modal open states
  const [openStates, setOpenStates] = useState<Record<T, boolean>>(() =>
    modalNames.reduce((acc, name) => {
      acc[name] = false
      return acc
    }, {} as Record<T, boolean>),
  )

  // Create memoized modal accessors with open/close callbacks
  const modals = useMemo(() => {
    return modalNames.reduce((acc, name) => {
      acc[name] = {
        isOpen: openStates[name] ?? false,
        open: () => setOpenStates(prev => ({ ...prev, [name]: true })),
        close: () => setOpenStates(prev => ({ ...prev, [name]: false })),
      }
      return acc
    }, {} as Record<T, ModalActions>)
  }, [modalNames, openStates])

  // Helper to close all modals
  const closeAll = useCallback(() => {
    setOpenStates(prev =>
      modalNames.reduce((acc, name) => {
        acc[name] = false
        return acc
      }, { ...prev } as Record<T, boolean>),
    )
  }, [modalNames])

  return { modals, closeAll }
}
