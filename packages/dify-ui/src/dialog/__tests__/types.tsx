import type { DialogActions, DialogProps } from '@langgenius/dify-ui/dialog'
import { Dialog } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function dialogActionsTypeContract() {
  const actionsRef = React.createRef<DialogActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<DialogProps['actionsRef']>['current']
  >()
  return <Dialog actionsRef={actionsRef} />
}
