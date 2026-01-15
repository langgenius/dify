// credit: https://github.com/manvalls/server-only-context/blob/main/src/index.ts

import { cache } from 'react'

export function serverOnlyContext<T>(defaultValue: T): [() => T, (v: T) => void] {
  const getRef = cache(() => ({ current: defaultValue }))

  const getValue = (): T => getRef().current

  const setValue = (value: T) => {
    getRef().current = value
  }

  return [getValue, setValue]
}
