'use client'

type FrontendCapability = {
  id: string
  name: string
  routes: string[]
  summary: string
  agent_guidance: string[]
}

type RouteContext = {
  app_id?: string
  capability_ids: string[]
  dataset_id?: string
  document_id?: string
  page_type: string
  pathname: string
  route_params: Record<string, string>
  token?: string
}

export const FRONTEND_CAPABILITIES: FrontendCapability[] = [
  {
    id: 'apps',
    name: 'Apps and App Overview',
    routes: ['/apps', '/app/:appId/overview'],
    summary: 'Create, browse, import, duplicate, configure, publish, inspect API access, and monitor Dify applications.',
    agent_guidance: [
      'Use the Apps list to create apps or open an existing app.',
      'Use App Overview to inspect app metadata, publishing status, API access, site URL, and MCP server publishing.',
    ],
  },
  {
    id: 'app-operations',
    name: 'App Operations',
    routes: ['/app/:appId/logs', '/app/:appId/annotations'],
    summary: 'Inspect app logs, conversations, traces, user feedback, and curated annotation replies.',
    agent_guidance: [
      'Use Logs to inspect runtime behavior before changing prompts or workflow logic.',
      'Use Annotations to review and curate reusable replies for supported app modes.',
    ],
  },
  {
    id: 'app-configuration',
    name: 'App Configuration',
    routes: ['/app/:appId/configuration'],
    summary: 'Configure app prompts, variables, model providers, tools, knowledge, and app-level behavior.',
    agent_guidance: [
      'Inspect visible form fields before editing configuration.',
      'Prefer browser actions against named fields and buttons from dify_get_page_context.',
      'After changing configuration, look for Save or Publish actions in the visible action list.',
    ],
  },
  {
    id: 'workflow',
    name: 'Workflow Builder',
    routes: ['/app/:appId/workflow'],
    summary: 'Visually orchestrate Dify workflow graphs with start, LLM, tool, logic, transform, retrieval, HTTP, human-input, loop, iteration, and end nodes.',
    agent_guidance: [
      'Call dify_get_workflow_context before editing to understand existing nodes and edges.',
      'Call dify_get_page_context to retrieve visible action IDs, then call dify_perform_browser_action to click add-node controls, block selector items, node panels, and form fields.',
      'Use browser actions for orchestration so Dify validation, collaboration, undo, and draft-sync behavior stay intact.',
      'After edits, call dify_get_workflow_context again and compare node and edge counts.',
    ],
  },
  {
    id: 'app-develop',
    name: 'App Develop',
    routes: ['/app/:appId/develop'],
    summary: 'Debug and preview application behavior with test inputs and generated outputs.',
    agent_guidance: [
      'Use visible form fields for test inputs.',
      'Run preview only after checking required inputs in page context.',
    ],
  },
  {
    id: 'datasets',
    name: 'Knowledge Datasets',
    routes: [
      '/datasets',
      '/datasets/connect',
      '/datasets/create',
      '/datasets/create-from-pipeline',
      '/datasets/:datasetId',
      '/datasets/:datasetId/api',
      '/datasets/:datasetId/documents',
      '/datasets/:datasetId/documents/create',
      '/datasets/:datasetId/documents/create-from-pipeline',
      '/datasets/:datasetId/documents/:documentId',
      '/datasets/:datasetId/documents/:documentId/settings',
      '/datasets/:datasetId/hitTesting',
      '/datasets/:datasetId/settings',
    ],
    summary: 'Create, import, segment, index, search, test, and manage knowledge datasets and documents.',
    agent_guidance: [
      'Use dataset pages to inspect document lists, indexing state, segment settings, retrieval tests, API access, and data source connections.',
    ],
  },
  {
    id: 'rag-pipeline',
    name: 'RAG Pipeline Builder',
    routes: ['/datasets/:datasetId/pipeline'],
    summary: 'Design dataset ingestion and transformation pipelines using the workflow-style RAG pipeline builder.',
    agent_guidance: [
      'Use workflow context and browser actions when a dataset pipeline mounts the workflow canvas.',
      'Confirm dataset and document scope before editing ingestion pipeline behavior.',
    ],
  },
  {
    id: 'tools',
    name: 'Tools and MCP Providers',
    routes: ['/tools'],
    summary: 'Manage built-in tools, custom tools, workflow tools, and remote MCP tool providers.',
    agent_guidance: [
      'Use tools pages to add MCP providers and refresh available tool lists for use in apps and workflows.',
    ],
  },
  {
    id: 'plugins',
    name: 'Plugins',
    routes: ['/plugins'],
    summary: 'Install, inspect, authorize, update, and manage plugins that provide models, tools, datasources, and triggers.',
    agent_guidance: [
      'Plugin installation and authorization can affect workflow node availability.',
    ],
  },
  {
    id: 'explore',
    name: 'Explore',
    routes: ['/explore/apps', '/explore/installed/:appId'],
    summary: 'Browse and run published apps available to the workspace.',
    agent_guidance: [
      'Use Explore to find runnable app experiences rather than editing builders.',
    ],
  },
  {
    id: 'published-app-runtime',
    name: 'Published App Runtime',
    routes: ['/chat/:token', '/chatbot/:token', '/completion/:token', '/workflow/:token', '/explore/installed/:appId'],
    summary: 'Run published chat, chatbot, completion, workflow, and installed Explore app experiences.',
    agent_guidance: [
      'Use visible input fields and submit actions to run published apps.',
      'Treat these routes as runtime experiences, not builders.',
    ],
  },
  {
    id: 'human-input',
    name: 'Human Input Forms',
    routes: ['/form/:token'],
    summary: 'Complete human-input forms generated by workflow human-in-the-loop steps.',
    agent_guidance: [
      'Inspect required fields before submitting a human-input form.',
      'Ask for user confirmation before submitting irreversible external workflow input.',
    ],
  },
  {
    id: 'workspace-settings',
    name: 'Workspace Settings',
    routes: ['/account', '/account/*'],
    summary: 'Manage members, model providers, data sources, billing, and workspace preferences.',
    agent_guidance: [
      'Model provider settings affect whether LLM and agent workflow nodes can run.',
      'Ask for user confirmation before changing workspace-wide settings.',
    ],
  },
  {
    id: 'authentication-onboarding',
    name: 'Authentication and Onboarding',
    routes: [
      '/install',
      '/init',
      '/activate',
      '/signin',
      '/signin/check-code',
      '/signin/invite-settings',
      '/signup',
      '/signup/check-code',
      '/signup/set-password',
      '/forgot-password',
      '/reset-password',
      '/reset-password/check-code',
      '/reset-password/set-password',
      '/webapp-signin',
      '/webapp-signin/check-code',
      '/webapp-reset-password',
      '/webapp-reset-password/check-code',
      '/webapp-reset-password/set-password',
      '/oauth-callback',
      '/account/oauth/authorize',
    ],
    summary: 'Install Dify, initialize accounts, authenticate users, handle OAuth, and reset passwords.',
    agent_guidance: [
      'Do not enter credentials or one-time codes unless the user provides them for the current session.',
      'Use these routes to understand setup state before trying authenticated workspace operations.',
    ],
  },
]

const matchRoute = (pathname: string, route: string) => {
  const routeParts = route.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)

  if (route.endsWith('/*')) {
    const prefix = route.slice(0, -2)
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }

  if (routeParts.length !== pathParts.length)
    return false

  return routeParts.every((part, index) => part.startsWith(':') || part === pathParts[index])
}

const getRouteParams = (pathname: string) => {
  const appMatch = pathname.match(/\/app\/([^/]+)/)
  const datasetMatch = pathname.match(/\/datasets\/([^/]+)/)
  const documentMatch = pathname.match(/\/documents\/([^/]+)/)
  const tokenMatch = pathname.match(/^\/(?:chat|chatbot|completion|workflow|form)\/([^/]+)/)

  return {
    ...(appMatch?.[1] ? { appId: appMatch[1] } : {}),
    ...(datasetMatch?.[1] ? { datasetId: datasetMatch[1] } : {}),
    ...(documentMatch?.[1] ? { documentId: documentMatch[1] } : {}),
    ...(tokenMatch?.[1] ? { token: tokenMatch[1] } : {}),
  }
}

const inferPageType = (pathname: string) => {
  if (pathname === '/apps')
    return 'apps-list'
  if (/\/app\/[^/]+\/workflow/.test(pathname))
    return 'workflow-builder'
  if (/\/app\/[^/]+\/configuration/.test(pathname))
    return 'app-configuration'
  if (/\/app\/[^/]+\/develop/.test(pathname))
    return 'app-debug-preview'
  if (/\/app\/[^/]+\/overview/.test(pathname))
    return 'app-overview'
  if (/\/app\/[^/]+\/logs/.test(pathname))
    return 'app-logs'
  if (/\/app\/[^/]+\/annotations/.test(pathname))
    return 'app-annotations'
  if (/\/datasets\/[^/]+\/pipeline/.test(pathname))
    return 'rag-pipeline-builder'
  if (/\/datasets\/[^/]+\/documents\/[^/]+\/settings/.test(pathname))
    return 'dataset-document-settings'
  if (/\/datasets\/[^/]+\/documents\/[^/]+/.test(pathname))
    return 'dataset-document-detail'
  if (/\/datasets\/[^/]+\/documents/.test(pathname))
    return 'dataset-documents'
  if (/\/datasets\/[^/]+\/hitTesting/.test(pathname))
    return 'dataset-hit-testing'
  if (/\/datasets\/[^/]+\/api/.test(pathname))
    return 'dataset-api'
  if (/\/datasets\/[^/]+\/settings/.test(pathname))
    return 'dataset-settings'
  if (pathname.startsWith('/datasets'))
    return 'datasets'
  if (pathname.startsWith('/tools'))
    return 'tools'
  if (pathname.startsWith('/plugins'))
    return 'plugins'
  if (pathname.startsWith('/explore'))
    return 'explore'
  if (/^\/(?:chat|chatbot|completion|workflow)\//.test(pathname))
    return 'published-app-runtime'
  if (/^\/form\//.test(pathname))
    return 'human-input-form'
  if ([
    '/install',
    '/init',
    '/activate',
    '/signin',
    '/signup',
    '/forgot-password',
    '/oauth-callback',
    '/account/oauth/authorize',
    '/webapp-signin',
  ].some(prefix => pathname.startsWith(prefix)) || pathname.includes('reset-password')) {
    return 'authentication-onboarding'
  }
  if (pathname.startsWith('/account'))
    return 'workspace-settings'

  return 'unknown'
}

export const getFrontendCapabilities = () => FRONTEND_CAPABILITIES

export const getRouteContext = (pathname: string): RouteContext => {
  const capabilityIds = FRONTEND_CAPABILITIES
    .filter(capability => capability.routes.some(route => matchRoute(pathname, route)))
    .map(capability => capability.id)

  const routeParams = getRouteParams(pathname)

  return {
    app_id: routeParams.appId,
    capability_ids: capabilityIds,
    dataset_id: routeParams.datasetId,
    document_id: routeParams.documentId,
    page_type: inferPageType(pathname),
    pathname,
    route_params: routeParams,
    token: routeParams.token,
  }
}

export const getCurrentRouteContext = () => {
  if (typeof window === 'undefined') {
    return getRouteContext('/')
  }

  return getRouteContext(window.location.pathname)
}
