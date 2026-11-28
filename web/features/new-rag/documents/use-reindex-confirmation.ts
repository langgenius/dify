import { useState } from 'react'

/**
 * Whether a reindex confirmation is showing. It shows only while the reindex can be started:
 * once it cannot (it began, the selection changed, the right to edit was lost) the request to
 * confirm is dropped, so the dialog neither stays open over an action that would do nothing nor
 * comes back by itself when the action is possible again.
 */
export function useReindexConfirmation(available: boolean, initiallyOpen = false) {
  const [requested, setRequested] = useState(initiallyOpen)
  if (requested && !available) setRequested(false)
  return { open: requested && available, setOpen: setRequested }
}
