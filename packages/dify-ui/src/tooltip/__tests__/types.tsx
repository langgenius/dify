import type { TooltipActions, TooltipProps } from '@langgenius/dify-ui/tooltip'
import { Tooltip } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function tooltipActionsTypeContract() {
  const actionsRef = React.createRef<TooltipActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<TooltipProps['actionsRef']>['current']
  >()
  return <Tooltip actionsRef={actionsRef} />
}
