import type { LangGeniusVersionInfo } from './app-context-types'
import type { ICurrentWorkspace } from '@/models/common'

export const initialLangGeniusVersionInfo: LangGeniusVersionInfo = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_notes: '',
  version: '',
}

export const initialWorkspaceInfo: ICurrentWorkspace = {
  id: '',
  name: '',
  plan: '',
  status: '',
  created_at: 0,
  role: 'normal',
  providers: [],
  trial_credits: 200,
  trial_credits_used: 0,
  trial_credits_exhausted_at: 0,
  next_credit_reset_date: 0,
}
