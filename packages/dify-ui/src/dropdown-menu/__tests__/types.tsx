import type {
  DropdownMenuActions,
  DropdownMenuHandle,
  DropdownMenuProps,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  createDropdownMenuHandle,
  DropdownMenu,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

type Payload = { documentId: string }

export function dropdownMenuTypeContracts() {
  const handle = createDropdownMenuHandle<Payload>()
  expectTypeOf(handle).toEqualTypeOf<DropdownMenuHandle<Payload>>()
  const trigger = (
    <DropdownMenuTrigger handle={handle} payload={{ documentId: 'document-1' }}>
      Actions
    </DropdownMenuTrigger>
  )
  const menu = (
    <DropdownMenu handle={handle}>
      {({ payload }) => {
        expectTypeOf(payload).toEqualTypeOf<Payload | undefined>()
        return <span>{payload?.documentId}</span>
      }}
    </DropdownMenu>
  )
  const invalid = (
    // @ts-expect-error Detached triggers preserve the handle payload contract.
    <DropdownMenuTrigger handle={handle} payload={{ documentId: 1 }}>
      Actions
    </DropdownMenuTrigger>
  )
  return { trigger, menu, invalid }
}

export function dropdownMenuActionsTypeContract() {
  const actionsRef = React.createRef<DropdownMenuActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<DropdownMenuProps['actionsRef']>['current']
  >()
  return <DropdownMenu actionsRef={actionsRef} />
}
