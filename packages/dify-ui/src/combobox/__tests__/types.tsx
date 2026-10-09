import type { ComboboxActions, ComboboxProps } from '@langgenius/dify-ui/combobox'
import { Combobox } from '@langgenius/dify-ui/combobox'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function comboboxActionsTypeContract() {
  const actionsRef = React.createRef<ComboboxActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<ComboboxProps<string>['actionsRef']>['current']
  >()
  return <Combobox actionsRef={actionsRef} />
}
