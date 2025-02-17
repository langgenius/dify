import type { ComponentProps } from 'react'

export type SliceProps<T = {}> = T & {
  text: string
} & ComponentProps<'span'>
