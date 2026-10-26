import type { Menu as BaseMenu } from '@base-ui/react/menu'
import type { MenuActions, MenuContentProps, MenuHandle, MenuProps } from '@langgenius/dify-ui/menu'
import { createMenuHandle, Menu, MenuContent, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

type Payload = { documentId: string }

export function menuTypeContracts() {
  const handle = createMenuHandle<Payload>()
  expectTypeOf(handle).toEqualTypeOf<MenuHandle<Payload>>()
  const trigger = (
    <MenuTrigger handle={handle} payload={{ documentId: 'document-1' }}>
      Actions
    </MenuTrigger>
  )
  const menu = (
    <Menu handle={handle}>
      {({ payload }) => {
        expectTypeOf(payload).toEqualTypeOf<Payload | undefined>()
        return <span>{payload?.documentId}</span>
      }}
    </Menu>
  )
  const invalid = (
    // @ts-expect-error Detached triggers preserve the handle payload contract.
    <MenuTrigger handle={handle} payload={{ documentId: 1 }}>
      Actions
    </MenuTrigger>
  )
  return { trigger, menu, invalid }
}

export function menuActionsTypeContract() {
  const actionsRef = React.createRef<MenuActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<NonNullable<MenuProps['actionsRef']>['current']>()
  return <Menu actionsRef={actionsRef} />
}

export function menuPositioningTypeContracts() {
  type Positioning = 'side' | 'align' | 'sideOffset' | 'alignOffset'
  expectTypeOf<Pick<MenuContentProps, Positioning>>().toEqualTypeOf<
    Pick<BaseMenu.Positioner.Props, Positioning>
  >()
  const inherited = <MenuContent>Actions</MenuContent>
  const independent = <MenuContent align="end">Actions</MenuContent>
  const invalidSide = (
    // @ts-expect-error Combined placement strings are not valid sides.
    <MenuContent side="inline-end-start">Actions</MenuContent>
  )
  // @ts-expect-error Logical sides are not alignments.
  const invalidAlign = <MenuContent align="inline-end">Actions</MenuContent>
  return { inherited, independent, invalidSide, invalidAlign }
}
