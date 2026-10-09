import type { SelectActions, SelectProps } from '@langgenius/dify-ui/select'
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
