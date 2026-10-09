import type {
  ComboboxActions,
  ComboboxOpenChangeEventDetails,
  ComboboxProps,
} from '@langgenius/dify-ui/combobox'
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

export function comboboxOpenChangeTypeContract() {
  expectTypeOf<ComboboxOpenChangeEventDetails>().toEqualTypeOf<
    Parameters<NonNullable<ComboboxProps<string>['onOpenChange']>>[1]
  >()
  return (
    <Combobox
      onOpenChange={(_open, details) => {
        // Keeping the popup mounted is an explicit opt-in; `actionsRef` alone no longer does it.
        details.preventUnmountOnClose()
      }}
    />
  )
}
