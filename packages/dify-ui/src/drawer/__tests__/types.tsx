import type { DrawerActions, DrawerProps } from '@langgenius/dify-ui/drawer'
import { Drawer } from '@langgenius/dify-ui/drawer'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function drawerActionsTypeContract() {
  const actionsRef = React.createRef<DrawerActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<DrawerProps['actionsRef']>['current']
  >()
  return <Drawer actionsRef={actionsRef} />
}
