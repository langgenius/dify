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

type GroupWithBoxProps = {
  children?: ReactNode
  boxProps?: Omit<BoxProps, 'children'>
  groupProps?: Omit<GroupProps, 'children'>
}
export const GroupWithBox = memo(({
  children,
  boxProps,
  groupProps,
}: GroupWithBoxProps) => {
  return (
    <Box {...boxProps}>
      <Group {...groupProps}>
        {children}
      </Group>
    </Box>
  )
})
