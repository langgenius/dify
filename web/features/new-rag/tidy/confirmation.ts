import type { PlanConfirmation } from './card-parts'
import type { RewriteRequest } from './review'
import { useState } from 'react'

/** What the page asks the reviewer to confirm before it acts. */
export type Confirmation =
  /** Turning Tidy on; `conflicts` is how the conflict-detection choice starts out. */
  | { kind: 'enable'; conflicts: boolean }
  | { kind: 'conflicts' }
  | ({ kind: 'plan' } & PlanConfirmation)
  | ({ kind: 'rewrite' } & RewriteRequest)

/**
 * The request stays after the dialog closes: the popup is still on screen while it animates out,
 * and must keep showing what was asked. `opening` counts openings, so each one starts fresh.
 */
export function useConfirmation() {
  const [state, setState] = useState<{ request: Confirmation; open: boolean; opening: number }>()
  return {
    request: state?.request,
    open: state?.open ?? false,
    opening: state?.opening ?? 0,
    ask: (request: Confirmation) =>
      setState((last) => ({ request, open: true, opening: (last?.opening ?? 0) + 1 })),
    close: () => setState((last) => last && { ...last, open: false }),
  }
}
