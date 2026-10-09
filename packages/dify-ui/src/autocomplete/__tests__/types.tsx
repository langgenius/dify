import type {
  AutocompleteActions,
  AutocompleteOpenChangeEventDetails,
  AutocompleteProps,
} from '@langgenius/dify-ui/autocomplete'
import { Autocomplete } from '@langgenius/dify-ui/autocomplete'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function autocompleteActionsTypeContract() {
  const actionsRef = React.createRef<AutocompleteActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<AutocompleteProps<string>['actionsRef']>['current']
  >()
  return <Autocomplete actionsRef={actionsRef} />
}

export function autocompleteOpenChangeTypeContract() {
  expectTypeOf<AutocompleteOpenChangeEventDetails>().toEqualTypeOf<
    Parameters<NonNullable<AutocompleteProps<string>['onOpenChange']>>[1]
  >()
  return (
    <Autocomplete
      onOpenChange={(_open, details) => {
        // Keeping the popup mounted is an explicit opt-in; `actionsRef` alone no longer does it.
        details.preventUnmountOnClose()
      }}
    />
  )
}
