import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { LangGeniusVersionInfo } from './app-context-types'

export const initialLangGeniusVersionInfo: LangGeniusVersionInfo = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_notes: '',
  version: '',
}

export const initialWorkspaceSummary: GetWorkspacesCurrentSummaryResponse = {
  id: '',
  name: '',
  plan: null,
  credits: null,
  role: 'normal',
}
