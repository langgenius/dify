'use client'

import type { Toggle as BaseToggleNS } from '@base-ui/react/toggle'
import { Toggle as BaseToggle } from '@base-ui/react/toggle'

type ToggleProps<Value extends string = string> = BaseToggleNS.Props<Value>

const Toggle = BaseToggle

export { Toggle }

export type { ToggleProps }
