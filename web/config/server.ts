import { env } from '@/env'

import 'server-only'

const withoutTrailingSlash = (value: string) => value.endsWith('/') ? value.slice(0, -1) : value

// Server-side requests need the origin; browser requests should keep using NEXT_PUBLIC_API_PREFIX.
export const SERVER_CONSOLE_API_PREFIX = env.CONSOLE_API_URL
  ? `${withoutTrailingSlash(env.CONSOLE_API_URL)}/console/api`
  : undefined
