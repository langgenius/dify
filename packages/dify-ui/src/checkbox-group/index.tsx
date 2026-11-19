'use client'

import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group'

type CheckboxGroupProps = BaseCheckboxGroup.Props
type CheckboxGroupChangeEventReason = BaseCheckboxGroup.ChangeEventReason
type CheckboxGroupChangeEventDetails = BaseCheckboxGroup.ChangeEventDetails
const CheckboxGroup = BaseCheckboxGroup

export { CheckboxGroup }

export type { CheckboxGroupChangeEventDetails, CheckboxGroupChangeEventReason, CheckboxGroupProps }
