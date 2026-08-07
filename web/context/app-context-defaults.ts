import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { LangGeniusVersionInfo } from './app-context-types'

export const initialLangGeniusVersionInfo: LangGeniusVersionInfo = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_date: '',
  release_notes: '',
  version: '',
  features: {
    can_replace_logo: false,
    model_load_balancing_enabled: false,
  },
  can_auto_update: false,
}

export const initialWorkspaceSummary: GetWorkspacesCurrentSummaryResponse = {
  id: '',
  name: '',
  plan: null,
  credits: null,
  role: 'normal',
}
