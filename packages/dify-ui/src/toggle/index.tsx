'use client'

import { Toggle as BaseToggle } from '@base-ui/react/toggle'

type ToggleProps<Value extends string = string> = BaseToggle.Props<Value>
type ToggleChangeEventReason = BaseToggle.ChangeEventReason
type ToggleChangeEventDetails = BaseToggle.ChangeEventDetails

const Toggle = BaseToggle

export { Toggle }

export type { ToggleChangeEventDetails, ToggleChangeEventReason, ToggleProps }
