'use client'

import type { CheckboxGroup as BaseCheckboxGroupNS } from '@base-ui/react/checkbox-group'
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group'

export type CheckboxGroupProps = BaseCheckboxGroupNS.Props

export function CheckboxGroup(props: CheckboxGroupProps) {
  return <BaseCheckboxGroup {...props} />
}
