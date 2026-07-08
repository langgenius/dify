import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { ICurrentWorkspace, LangGeniusVersionResponse } from '@/models/common'

export const userProfilePlaceholder: GetAccountProfileResponse = {
  id: '',
  name: '',
  email: '',
  avatar: '',
  avatar_url: '',
  is_password_set: false,
}

export const initialLangGeniusVersionInfo: LangGeniusVersionResponse = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_date: '',
  release_notes: '',
  version: '',
  can_auto_update: false,
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
  next_credit_reset_date: 0,
}
