import type { Menu } from '@base-ui/react/menu'
import type {
  DropdownMenuActions,
  DropdownMenuContentProps,
  DropdownMenuHandle,
  DropdownMenuProps,
  DropdownMenuSubContentProps,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  createDropdownMenuHandle,
  DropdownMenu,
  DropdownMenuSubContent,
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

export function dropdownMenuPositioningTypeContracts() {
  type Positioning = 'side' | 'align' | 'sideOffset' | 'alignOffset'
  expectTypeOf<Pick<DropdownMenuContentProps, Positioning>>().toEqualTypeOf<
    Pick<Menu.Positioner.Props, Positioning>
  >()
  expectTypeOf<Pick<DropdownMenuSubContentProps, Positioning>>().toEqualTypeOf<
    Pick<Menu.Positioner.Props, Positioning>
  >()
  const inherited = <DropdownMenuSubContent>Actions</DropdownMenuSubContent>
  const independent = <DropdownMenuSubContent align="end">Actions</DropdownMenuSubContent>
  const invalidSide = (
    // @ts-expect-error Combined placement strings are not valid sides.
    <DropdownMenuSubContent side="inline-end-start">Actions</DropdownMenuSubContent>
  )
  // @ts-expect-error Logical sides are not alignments.
  const invalidAlign = <DropdownMenuSubContent align="inline-end">Actions</DropdownMenuSubContent>
  return { inherited, independent, invalidSide, invalidAlign }
}
