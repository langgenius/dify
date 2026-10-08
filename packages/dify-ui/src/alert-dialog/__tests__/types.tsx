import type { AlertDialogActions, AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import { AlertDialog } from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function alertDialogActionsTypeContract() {
  const actionsRef = React.createRef<AlertDialogActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<AlertDialogProps['actionsRef']>['current']
  >()
  return <AlertDialog actionsRef={actionsRef} />
}
