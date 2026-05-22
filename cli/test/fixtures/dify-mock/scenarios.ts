export type Scenario
  = | 'happy'
    | 'sso'
    | 'denied'
    | 'expired'
    | 'auth-expired'
    | 'rate-limited'
    | 'server-5xx'
    | 'slow-down'
    | 'stream-error'
    | 'hitl-pause'
    | 'hitl-resume'
    | 'server-version-empty'
    | 'server-version-unsupported'

export type AccountFixture = {
  id: string
  email: string
  name: string
  is_external: boolean
  current_workspace_id: string | null
}

export type WorkspaceFixture = {
  id: string
  name: string
  role: string
  status: string
  is_current: boolean
}

export type AppFixture = {
  id: string
  workspace_id: string
  workspace_name: string
  name: string
  mode: string
  description: string
  tags: { name: string }[]
  created_at: string
  updated_at: string
  created_by_name: string
  author?: string
  service_api_enabled?: boolean
  is_agent?: boolean
  parameters?: Record<string, unknown>
  input_schema?: Record<string, unknown>
}

export type SessionFixture = {
  id: string
  prefix: string
  client_id: string
  device_label: string
  created_at: string
  last_used_at: string
  expires_at: string
}

export const ACCOUNT: AccountFixture = {
  id: 'acct-1',
  email: 'tester@dify.ai',
  name: 'Test Tester',
  is_external: false,
  current_workspace_id: 'ws-1',
}

export const WORKSPACES: WorkspaceFixture[] = [
  { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', is_current: true },
  { id: 'ws-2', name: 'Other', role: 'normal', status: 'normal', is_current: false },
]

export const APPS: AppFixture[] = [
  {
    id: 'app-1',
    workspace_id: 'ws-1',
    workspace_name: 'Default',
    name: 'Greeter',
    mode: 'chat',
    description: 'A simple greeting bot',
    tags: [{ name: 'demo' }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    created_by_name: 'tester',
    author: 'tester',
    service_api_enabled: true,
    is_agent: false,
    parameters: {
      opening_statement: 'Hi, I am Greeter.',
      suggested_questions: ['What is your name?'],
      user_input_form: [
        { type: 'text-input', variable: 'name', label: 'Your name', required: true },
      ],
      system_parameters: { image_file_size_limit: 10 },
    },
  },
  {
    id: 'app-4',
    workspace_id: 'ws-2',
    workspace_name: 'Other',
    name: 'Researcher',
    mode: 'agent-chat',
    description: 'An agent that researches',
    tags: [],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-02T00:00:00Z',
    created_by_name: 'tester',
    author: 'tester',
    service_api_enabled: false,
    is_agent: true,
  },
  {
    id: 'app-2',
    workspace_id: 'ws-1',
    workspace_name: 'Default',
    name: 'Workflow',
    mode: 'workflow',
    description: '',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    created_by_name: 'tester',
    author: 'tester',
    service_api_enabled: false,
  },
  {
    id: 'app-3',
    workspace_id: 'ws-2',
    workspace_name: 'Other',
    name: 'OtherWS Bot',
    mode: 'chat',
    description: '',
    tags: [{ name: 'wip' }],
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-04T00:00:00Z',
    created_by_name: 'admin',
    author: 'admin',
    service_api_enabled: false,
  },
]

export const SESSIONS: SessionFixture[] = [
  {
    id: 'tok-1',
    prefix: 'dfoa',
    client_id: 'difyctl',
    device_label: 'difyctl on laptop',
    created_at: '2026-05-01T00:00:00Z',
    last_used_at: '2026-05-08T00:00:00Z',
    expires_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'tok-2',
    prefix: 'dfoa',
    client_id: 'difyctl',
    device_label: 'difyctl on desktop',
    created_at: '2026-04-15T00:00:00Z',
    last_used_at: '2026-05-07T00:00:00Z',
    expires_at: '2026-07-15T00:00:00Z',
  },
  {
    id: 'tok-3',
    prefix: 'dfoa',
    client_id: 'cloud-console',
    device_label: 'web ui',
    created_at: '2026-05-05T00:00:00Z',
    last_used_at: '2026-05-08T00:00:00Z',
    expires_at: '2026-08-05T00:00:00Z',
  },
]
