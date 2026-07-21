import type { ToolProviderType } from '@dify/contracts/api/console/workspaces/types.gen'
import { zToolProviderType } from '@dify/contracts/api/console/workspaces/zod.gen'

export const parseToolProviderType = (providerType: unknown): ToolProviderType =>
  zToolProviderType.parse(providerType)
