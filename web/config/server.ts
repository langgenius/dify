import { env } from '@/env'

import 'server-only'

const withoutTrailingSlash = (value: string) => value.endsWith('/') ? value.slice(0, -1) : value

// Server-side requests need the origin; browser requests should keep using NEXT_PUBLIC_API_PREFIX.
const serverConsoleApiUrl = env.SERVER_CONSOLE_API_URL || env.CONSOLE_API_URL

export const SERVER_CONSOLE_API_PREFIX = serverConsoleApiUrl
  ? `${withoutTrailingSlash(serverConsoleApiUrl)}/console/api`
  : undefined
