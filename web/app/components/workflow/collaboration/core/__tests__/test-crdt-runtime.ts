import type { CollaborationManager } from '../collaboration-manager'
import { crdtRuntime } from '../crdt-runtime'

export const attachCrdtRuntime = (manager: CollaborationManager): void => {
  const internals = manager as unknown as { crdtRuntime: typeof crdtRuntime }
  internals.crdtRuntime = crdtRuntime
}
