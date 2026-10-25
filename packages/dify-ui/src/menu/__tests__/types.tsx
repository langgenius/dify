import type { Menu as BaseMenu } from '@base-ui/react/menu'
import type {
  MenuActions,
  MenuContentProps,
  MenuHandle,
  MenuProps,
  MenuSubmenuContentProps,
} from '@langgenius/dify-ui/menu'
import { createMenuHandle, Menu, MenuSubmenuContent, MenuTrigger } from '@langgenius/dify-ui/menu'
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
  expectTypeOf<Pick<MenuSubmenuContentProps, Positioning>>().toEqualTypeOf<
    Pick<BaseMenu.Positioner.Props, Positioning>
  >()
  const inherited = <MenuSubmenuContent>Actions</MenuSubmenuContent>
  const independent = <MenuSubmenuContent align="end">Actions</MenuSubmenuContent>
  const invalidSide = (
    // @ts-expect-error Combined placement strings are not valid sides.
    <MenuSubmenuContent side="inline-end-start">Actions</MenuSubmenuContent>
  )
  // @ts-expect-error Logical sides are not alignments.
  const invalidAlign = <MenuSubmenuContent align="inline-end">Actions</MenuSubmenuContent>
  return { inherited, independent, invalidSide, invalidAlign }
}
