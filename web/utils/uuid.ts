/**
 * Generate a UUID without relying on `crypto.randomUUID`, which is only
 * available in secure contexts (HTTPS or localhost). Self-hosted deployments
 * served over plain HTTP on a LAN address have no `crypto.randomUUID`, and
 * calling it throws `TypeError: crypto.randomUUID is not a function`
 * (see issue #45643).
 *
 * Prefers `crypto.randomUUID` when available and falls back to `uuid` v4.
 */
import { v4 as uuid4 } from 'uuid'

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return uuid4()
}
