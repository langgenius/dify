import type { GetVersionResponse } from '@dify/contracts/api/console/version/types.gen'

export type LangGeniusVersionInfo = GetVersionResponse & {
  current_version: string
  latest_version: string
  current_env: string
}
