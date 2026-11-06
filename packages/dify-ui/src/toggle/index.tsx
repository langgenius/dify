'use client'

import { Toggle as BaseToggle } from '@base-ui/react/toggle'
import { cn } from '../cn'
import { focusRingClassName } from '../internal/focus'
import { resolveClassName } from '../internal/resolve-class-name'

type ToggleProps<Value extends string = string> = BaseToggle.Props<Value>
type ToggleChangeEventReason = BaseToggle.ChangeEventReason
type ToggleChangeEventDetails = BaseToggle.ChangeEventDetails

function Toggle<Value extends string = string>({ className, ...props }: ToggleProps<Value>) {
  return (
    <BaseToggle<Value>
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

export { Toggle }

export type { ToggleChangeEventDetails, ToggleChangeEventReason, ToggleProps }
