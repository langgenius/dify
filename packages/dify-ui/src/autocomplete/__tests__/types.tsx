import type { AutocompleteActions, AutocompleteProps } from '@langgenius/dify-ui/autocomplete'
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
