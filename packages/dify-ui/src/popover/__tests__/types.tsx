import type { PopoverActions, PopoverProps } from '@langgenius/dify-ui/popover'
import { Popover } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function popoverActionsTypeContract() {
  const actionsRef = React.createRef<PopoverActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<PopoverProps['actionsRef']>['current']
  >()
  return <Popover actionsRef={actionsRef} />
}
