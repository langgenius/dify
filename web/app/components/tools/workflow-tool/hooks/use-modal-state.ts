'use client'
import { useBoolean } from 'ahooks'
import { useCallback } from 'react'

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

/**
 * Hook for managing multiple modal states
 */
export const useMultiModalState = <T extends string>(modalNames: T[]) => {
  // Create individual modal states
  const modals = modalNames.reduce((acc, name) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [isOpen, { setTrue: open, setFalse: close }] = useBoolean(false)
    acc[name] = { isOpen, open, close }
    return acc
  }, {} as Record<T, { isOpen: boolean, open: () => void, close: () => void }>)

  // Helper to close all modals
  const closeAll = useCallback(() => {
    modalNames.forEach((name) => {
      modals[name].close()
    })
  }, [modals, modalNames])

  return { modals, closeAll }
}
