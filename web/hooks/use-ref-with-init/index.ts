/*!
 * Adapted from Base UI (MIT). Copyright (c) 2019 Material-UI SAS.
 * https://github.com/mui/base-ui/blob/50f90e8f8ff4cc77b624b6ad8550346e00b15445/packages/utils/src/useRefWithInit.ts
 * See ./LICENSE for the full license.
 */

'use client'
import * as React from 'react'

const UNINITIALIZED = {}

/**
 * Lazily initializes a ref. Later changes to initArg do not reinitialize it.
 * The initializer runs during render and must be safe to retry or discard.
 */
export function useRefWithInit<T>(init: () => T): React.RefObject<T>
export function useRefWithInit<T, U>(init: (arg: U) => T, initArg: U): React.RefObject<T>
export function useRefWithInit(init: (arg?: unknown) => unknown, initArg?: unknown) {
  const ref = React.useRef<unknown>(UNINITIALIZED)

  if (ref.current === UNINITIALIZED) {
    ref.current = init(initArg)
  }

  return ref
}
