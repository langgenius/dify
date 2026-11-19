import type { FieldActions, FieldProps } from '@langgenius/dify-ui/field'
import { Field } from '@langgenius/dify-ui/field'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function fieldActionsTypeContract() {
  const actionsRef = React.createRef<FieldActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<NonNullable<FieldProps['actionsRef']>['current']>()
  return <Field actionsRef={actionsRef} />
}
