import type { PopoverActions, PopoverContentProps, PopoverProps } from '@langgenius/dify-ui/popover'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function popoverActionsTypeContract() {
  const actionsRef = React.createRef<PopoverActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<PopoverProps['actionsRef']>['current']
  >()
  return <Popover actionsRef={actionsRef} />
}

export function popoverPositioningTypeContract() {
  const position: Pick<PopoverContentProps, 'side' | 'align' | 'sideOffset'> = {
    side: 'inline-end',
    align: 'start',
    sideOffset: ({ side, align, anchor }) => {
      expectTypeOf(side).toEqualTypeOf<NonNullable<PopoverContentProps['side']>>()
      expectTypeOf(align).toEqualTypeOf<NonNullable<PopoverContentProps['align']>>()
      return anchor.width / 2
    },
  }
  const content = <PopoverContent {...position}>Details</PopoverContent>
  // @ts-expect-error Combined placement strings are no longer part of the public API.
  const legacy = <PopoverContent placement="bottom-start">Details</PopoverContent>
  // @ts-expect-error Alignment is independent of the side.
  const invalid = <PopoverContent align="bottom">Details</PopoverContent>
  return { content, legacy, invalid }
}
