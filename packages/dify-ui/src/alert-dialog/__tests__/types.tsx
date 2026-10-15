import type {
  AlertDialogActions,
  AlertDialogHandle,
  AlertDialogProps,
} from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function alertDialogActionsTypeContract() {
  const actionsRef = React.createRef<AlertDialogActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<AlertDialogProps['actionsRef']>['current']
  >()
  return <AlertDialog actionsRef={actionsRef} />
}

type Payload = { documentId: string }

export function alertDialogHandleTypeContracts() {
  const handle = createAlertDialogHandle<Payload>()
  expectTypeOf(handle).toEqualTypeOf<AlertDialogHandle<Payload>>()
  const trigger = (
    <AlertDialogTrigger handle={handle} payload={{ documentId: 'document-1' }}>
      Delete
    </AlertDialogTrigger>
  )
  const dialog = (
    <AlertDialog handle={handle}>
      {({ payload }) => {
        expectTypeOf(payload).toEqualTypeOf<Payload | undefined>()
        return <span>{payload?.documentId}</span>
      }}
    </AlertDialog>
  )
  const invalid = (
    // @ts-expect-error Detached triggers preserve the handle payload contract.
    <AlertDialogTrigger handle={handle} payload={{ documentId: 1 }}>
      Delete
    </AlertDialogTrigger>
  )
  return { trigger, dialog, invalid }
}
