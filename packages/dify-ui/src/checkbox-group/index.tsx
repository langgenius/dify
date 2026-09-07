'use client'

import type { CheckboxGroup as BaseCheckboxGroupNS } from '@base-ui/react/checkbox-group'
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group'

type CheckboxGroupProps = BaseCheckboxGroupNS.Props

function CheckboxGroup(props: CheckboxGroupProps) {
  return <BaseCheckboxGroup {...props} />
}

export { CheckboxGroup }

export type { CheckboxGroupProps }
