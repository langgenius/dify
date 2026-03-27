import { readAuthSessionMetadata, type AuthSessionMetadata } from '../../fixtures/auth'
import type { DifyWorld } from './world'

export const getCachedSession = async (world: DifyWorld): Promise<AuthSessionMetadata> => {
  world.session ??= await readAuthSessionMetadata()
  return world.session
}
