import type {
  SelectActions,
  SelectChangeEventDetails,
  SelectOpenChangeEventDetails,
  SelectProps,
} from '@langgenius/dify-ui/select'
import { Select } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function selectActionsTypeContract() {
  const actionsRef = React.createRef<SelectActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<SelectProps<string>['actionsRef']>['current']
  >()
  return <Select actionsRef={actionsRef} />
}

export function selectEventDetailsTypeContract() {
  expectTypeOf<SelectOpenChangeEventDetails>().toEqualTypeOf<
    Parameters<NonNullable<SelectProps<string>['onOpenChange']>>[1]
  >()
  expectTypeOf<SelectChangeEventDetails>().toEqualTypeOf<
    Parameters<NonNullable<SelectProps<string>['onValueChange']>>[1]
  >()
  return (
    <Select
      onOpenChange={(_open, details) => {
        // Keeping the popup mounted is an explicit opt-in; `actionsRef` alone no longer does it.
        details.preventUnmountOnClose()
      }}
    />
  )
}
