/**
 * Vitest global teardown — runs once after all E2E suites complete.
 *
 * Responsibilities:
 *  1. Delete all conversations created on the staging server during the run
 *     (collected via registerConversation() in test suites).
 *
 * Deletion is best-effort — failures are logged but do not fail the run.
 */

import { cleanupRegisteredConversations } from '../helpers/cleanup-registry.js'

export async function teardown(): Promise<void> {
  await cleanupRegisteredConversations()
}
