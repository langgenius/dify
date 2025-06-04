import type { ReactNode } from 'react'
import { memo } from 'react'
import {
  Box,
  Group,
} from '.'
import type {
  BoxProps,
  GroupProps,
} from '.'

export type BoxGroupProps = {
  children?: ReactNode
  boxProps?: Omit<BoxProps, 'children'>
  groupProps?: Omit<GroupProps, 'children'>
}
export const BoxGroup = memo(({
  children,
  boxProps,
  groupProps,
}: BoxGroupProps) => {
  return (
    <Box {...boxProps}>
      <Group {...groupProps}>
        {children}
      </Group>
    </Box>
  )
})
