import type { ApiKeyValues } from '@/app/components/share/connections/api-key-dialog'
import { ORPCError } from '@orpc/client'

export function validateDemoApiKey(values: ApiKeyValues | undefined) {
  const apiKey = values?.credentials.api_key
  if (typeof apiKey !== 'string' || !apiKey.trim().startsWith('sk'))
    throw new ORPCError('connection_credentials_invalid')
}
