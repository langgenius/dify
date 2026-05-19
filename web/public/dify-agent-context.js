(function () {
  const VERSION = '2026-05-14'
  const tools = new Map()
  const pageContexts = new Map()

  const hash = (value) => {
    let next = 5381
    for (let i = 0; i < value.length; i += 1)
      next = ((next << 5) + next) ^ value.charCodeAt(i)
    return (next >>> 0).toString(36)
  }

  const textOf = (element) => (
    element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.getAttribute('placeholder')
    || element.innerText
    || element.textContent
    || element.value
    || ''
  ).replace(/\s+/g, ' ').trim()

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  const selectorOf = (element) => {
    if (element.id)
      return `#${CSS.escape(element.id)}`

    const parts = []
    let node = element
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
      let part = node.tagName.toLowerCase()
      const testId = node.getAttribute('data-testid')
      if (testId)
        part += `[data-testid="${CSS.escape(testId)}"]`
      else {
        const parent = node.parentElement
        if (parent) {
          const siblings = Array.from(parent.children).filter(item => item.tagName === node.tagName)
          if (siblings.length > 1)
            part += `:nth-of-type(${siblings.indexOf(node) + 1})`
        }
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  const getRouteContext = () => {
    const pathname = window.location.pathname
    const appMatch = pathname.match(/^\/app\/([^/]+)/)
    const datasetMatch = pathname.match(/^\/datasets\/([^/]+)/)
    let pageType = 'unknown'
    const capabilityIds = []

    if (pathname === '/apps' || pathname.startsWith('/app/')) {
      pageType = pathname.includes('/workflow') ? 'workflow-builder' : 'studio-apps'
      capabilityIds.push('apps', 'workflow')
    }
    else if (pathname.startsWith('/datasets')) {
      pageType = 'datasets'
      capabilityIds.push('datasets', 'rag-pipeline')
    }
    else if (pathname.startsWith('/tools') || pathname.startsWith('/plugins')) {
      pageType = 'tools-plugins'
      capabilityIds.push('tools', 'plugins', 'mcp')
    }
    else if (pathname.startsWith('/signin') || pathname.startsWith('/install') || pathname.startsWith('/init')) {
      pageType = 'authentication-onboarding'
      capabilityIds.push('authentication-onboarding')
    }

    return {
      capability_ids: capabilityIds,
      page_type: pageType,
      pathname,
      route_params: {
        app_id: appMatch ? appMatch[1] : undefined,
        dataset_id: datasetMatch ? datasetMatch[1] : undefined,
      },
    }
  }

  const getCapabilities = () => ([
    { id: 'apps', title: 'Apps', description: 'Create, import, configure, and operate Dify applications.' },
    { id: 'workflow', title: 'Workflow Builder', description: 'Create workflow graphs, configure nodes, run drafts, and publish versions.' },
    { id: 'datasets', title: 'Knowledge', description: 'Create datasets, upload documents, configure retrieval, and test RAG.' },
    { id: 'rag-pipeline', title: 'RAG Pipeline', description: 'Configure dataset ingestion and indexing workflows.' },
    { id: 'tools', title: 'Tools', description: 'Configure built-in, custom, workflow, and MCP tools.' },
    { id: 'plugins', title: 'Plugins', description: 'Install and manage providers, tools, and extension packages.' },
    { id: 'mcp', title: 'MCP', description: 'Expose published apps and tools as MCP services where supported.' },
    { id: 'model-providers', title: 'Model Providers', description: 'Configure LLM, embedding, rerank, TTS, and speech providers.' },
    { id: 'published-runtime', title: 'Published Runtime', description: 'Run published chat, completion, and workflow apps.' },
    { id: 'human-input', title: 'Human Input', description: 'Pause workflows for approval and resume after form submission.' },
    { id: 'workspace-settings', title: 'Workspace Settings', description: 'Manage members, billing, integrations, and security settings.' },
    { id: 'authentication-onboarding', title: 'Authentication', description: 'Sign in, install, initialize, and recover accounts.' },
    { id: 'explore', title: 'Explore', description: 'Browse and launch installed or shared applications.' },
    { id: 'non-visual-browser-control', title: 'Non-visual Browser Control', description: 'Operate visible UI through stable DOM action descriptors.' },
  ])

  const ENTRY_NODE_TYPES = new Set(['start', 'trigger-schedule', 'trigger-webhook', 'trigger-plugin', 'datasource'])
  const TERMINAL_NODE_TYPES = new Set(['end', 'answer'])
  const CONTROL_NODE_TYPES = new Set(['if-else', 'question-classifier', 'iteration', 'loop'])

  const compactNode = node => ({
    connected_source_handles: node.data?._connectedSourceHandleIds,
    connected_target_handles: node.data?._connectedTargetHandleIds,
    description: node.data?.desc,
    id: node.id,
    position: node.position,
    provider: node.data?.provider_name,
    selected: Boolean(node.selected || node.data?.selected),
    title: node.data?.title,
    tool: node.data?.tool_label || node.data?.tool_name,
    type: node.data?.type,
    variable: node.data?.variable,
    variables: node.data?.variables,
  })

  const compactEdge = edge => ({
    id: edge.id,
    source: edge.source,
    source_handle: edge.sourceHandle,
    source_type: edge.data?.sourceType,
    target: edge.target,
    target_handle: edge.targetHandle,
    target_type: edge.data?.targetType,
  })

  const summarizeNode = node => ({
    id: node.id,
    title: node.data?.title,
    type: node.data?.type,
  })

  const collectGraphIssues = (nodes, edges) => {
    const issues = []
    const nodeIds = new Set(nodes.map(node => node.id))
    const entryNodes = nodes.filter(node => ENTRY_NODE_TYPES.has(node.data?.type))
    const terminalNodes = nodes.filter(node => TERMINAL_NODE_TYPES.has(node.data?.type))
    const danglingEdges = edges.filter(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))

    if (!nodes.length)
      return [{ code: 'empty_graph', message: 'The workflow graph has no nodes.', severity: 'error' }]
    if (!entryNodes.length)
      issues.push({ code: 'missing_entry_node', message: 'The workflow graph has no Start, Trigger, or Data Source entry node.', severity: 'error' })
    if (!terminalNodes.length)
      issues.push({ code: 'missing_terminal_node', message: 'The workflow graph has no End or Answer terminal node.', severity: 'warning' })
    if (danglingEdges.length)
      issues.push({ code: 'dangling_edges', message: 'Some edges reference missing source or target nodes.', node_ids: Array.from(new Set(danglingEdges.flatMap(edge => [edge.source, edge.target]))), severity: 'error' })

    const adjacency = new Map(nodes.map(node => [node.id, []]))
    edges.forEach((edge) => {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target))
        adjacency.get(edge.source)?.push(edge.target)
    })
    const reachable = new Set()
    const queue = entryNodes.map(node => node.id)
    while (queue.length) {
      const current = queue.shift()
      if (!current || reachable.has(current))
        continue
      reachable.add(current)
      adjacency.get(current)?.forEach((target) => {
        if (!reachable.has(target))
          queue.push(target)
      })
    }
    const unreachableNodes = entryNodes.length ? nodes.filter(node => !reachable.has(node.id)) : []
    if (unreachableNodes.length)
      issues.push({ code: 'unreachable_nodes', message: 'Some nodes cannot be reached from any entry node.', node_ids: unreachableNodes.map(node => node.id), severity: 'warning' })

    const orphanControlNodes = nodes.filter(node => CONTROL_NODE_TYPES.has(node.data?.type) && !edges.some(edge => edge.source === node.id))
    if (orphanControlNodes.length)
      issues.push({ code: 'control_nodes_without_outputs', message: 'Some branching, loop, or iteration nodes do not have outgoing edges.', node_ids: orphanControlNodes.map(node => node.id), severity: 'warning' })

    return issues
  }

  const summarizeGraph = (graph) => {
    const nodes = graph?.nodes || []
    const edges = graph?.edges || []
    const nodeTypeCounts = nodes.reduce((counts, node) => {
      const type = node.data?.type || 'unknown'
      counts[type] = (counts[type] || 0) + 1
      return counts
    }, {})

    return {
      edge_count: edges.length,
      edges: edges.map(compactEdge),
      entry_nodes: nodes.filter(node => ENTRY_NODE_TYPES.has(node.data?.type)).map(summarizeNode),
      issues: collectGraphIssues(nodes, edges),
      node_count: nodes.length,
      node_type_counts: nodeTypeCounts,
      nodes: nodes.map(compactNode),
      start_variables: nodes
        .filter(node => ENTRY_NODE_TYPES.has(node.data?.type) && Array.isArray(node.data?.variables))
        .flatMap(node => node.data.variables.map(variable => ({ node_id: node.id, node_title: node.data?.title, variable }))),
      terminal_nodes: nodes.filter(node => TERMINAL_NODE_TYPES.has(node.data?.type)).map(summarizeNode),
    }
  }

  const summarizeDraft = draft => ({
    draft: {
      hash: draft.hash,
      id: draft.id,
      updated_at: draft.updated_at,
      version: draft.version,
    },
    graph: summarizeGraph(draft.graph),
    variables: {
      conversation_variable_count: draft.conversation_variables?.length || 0,
      environment_variable_count: draft.environment_variables?.length || 0,
    },
  })

  const workflowGuide = () => ({
    graph_contract: {
      nodes: 'React Flow nodes with id, type, position, data.type/title/desc, and node-specific config.',
      edges: 'React Flow edges connecting source -> target with sourceType and targetType in data.',
      draft_hash: 'Use the draft hash when syncing to avoid overwriting newer edits.',
    },
    build_strategy: [
      'Map the business process to entry, transform, tool, control-flow, human-input, and terminal nodes.',
      'Fetch default node configs before constructing node data so generated graphs match Dify backend validation.',
      'For large construction, import DSL or sync the full draft graph, then verify with browser context.',
      'Validate, run representative inputs, inspect node executions, iterate, then publish.',
    ],
    node_types: {
      entry: ['start', 'trigger-schedule', 'trigger-webhook', 'trigger-plugin'],
      reasoning_and_generation: ['llm', 'agent', 'question-classifier'],
      data_and_tools: ['knowledge-retrieval', 'tool', 'http-request', 'document-extractor'],
      control_flow: ['if-else', 'iteration', 'loop', 'loop-end', 'human-input'],
      transform: ['code', 'template-transform', 'variable-assigner', 'variable-aggregator', 'parameter-extractor', 'list-operator'],
      terminal: ['end', 'answer'],
    },
    debug_cycle: ['dify_search_marketplace_plugins', 'dify_list_installed_plugin_capabilities', 'dify_get_trigger_provider_detail', 'dify_get_workflow_node_default_config', 'dify_validate_workflow_graph', 'dify_run_workflow_draft', 'dify_get_workflow_runs', 'dify_get_workflow_run_detail', 'dify_get_workflow_run_node_executions', 'dify_sync_workflow_draft or dify_import_app_dsl', 'dify_publish_workflow'],
  })

  const getDomSnapshot = (input) => {
    const actionLimit = Number.isFinite(input?.action_limit) ? input.action_limit : 80
    const textLimit = Number.isFinite(input?.text_limit) ? input.text_limit : 40
    const selector = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[data-testid]',
      '.cursor-pointer',
    ].join(',')

    const actions = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .slice(0, actionLimit)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const name = textOf(element)
        const descriptor = {
          action_id: `dify_action_${hash([element.tagName, element.getAttribute('role') || '', name, selectorOf(element), element.getAttribute('href') || '', element.getAttribute('placeholder') || '', element.getAttribute('type') || ''].join('|'))}`,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          name,
          href: element.getAttribute('href') || undefined,
          placeholder: element.getAttribute('placeholder') || undefined,
          selector: selectorOf(element),
          state: {
            checked: element.checked === undefined ? undefined : !!element.checked,
            disabled: element.disabled === undefined ? undefined : !!element.disabled,
            expanded: element.getAttribute('aria-expanded') || undefined,
            selected: element.getAttribute('aria-selected') || undefined,
          },
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        }
        element.setAttribute('data-dify-agent-action-id', descriptor.action_id)
        return descriptor
      })

    const text = Array.from(document.body.querySelectorAll('h1,h2,h3,p,span,label,div'))
      .filter(isVisible)
      .map(textOf)
      .filter(Boolean)
      .slice(0, textLimit)

    return {
      actions,
      dialogs: Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]')).filter(isVisible).map(textOf).filter(Boolean),
      title: document.title,
      url: window.location.href,
      visible_text: Array.from(new Set(text)),
    }
  }

  const csrfHeaders = () => {
    const match = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)
    return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {}
  }

  const readJson = async (response) => {
    const text = await response.text()
    let data = null
    try { data = text ? JSON.parse(text) : null }
    catch (_) { data = { text } }
    if (!response.ok)
      throw new Error(`${response.status} ${data?.message || data?.text || response.statusText}`)
    return data
  }

  const consoleFetch = async (path, options) => {
    const headers = {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...csrfHeaders(),
      ...(options?.headers || {}),
    }
    return readJson(await fetch(`/console/api/${path.replace(/^\/+/, '')}`, {
      credentials: 'include',
      ...options,
      headers,
    }))
  }

  const marketplaceFetch = async (path, options) => {
    const headers = {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Dify-Version': '999.0.0',
      ...(options?.headers || {}),
    }
    const prefix = window.__DIFY_MARKETPLACE_API_PREFIX__ || 'https://marketplace.dify.ai/api/v1'

    return readJson(await fetch(`${prefix.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`, {
      cache: 'no-store',
      ...options,
      headers,
    }))
  }

  const parseRunSummary = (events) => {
    const finalEvent = [...events].reverse().find(event => ['workflow_finished', 'workflow_paused', 'error'].includes(event.event)) || null
    const text = events
      .filter(event => event.event === 'text_chunk' || event.event === 'text_replace')
      .map(event => event.data?.text)
      .filter(value => typeof value === 'string')
      .join('')
    return {
      event_count: events.length,
      final_event: finalEvent,
      node_executions: events.filter(event => event.event === 'node_finished'),
      status: finalEvent?.data?.status || finalEvent?.event || null,
      task_id: finalEvent?.task_id || events.find(event => event.task_id)?.task_id || null,
      text,
      workflow_run_id: finalEvent?.workflow_run_id || events.find(event => event.workflow_run_id)?.workflow_run_id || null,
    }
  }

  const runWorkflowSse = async (path, body) => {
    const response = await fetch(`/console/api/${path.replace(/^\/+/, '')}`, {
      body: JSON.stringify(body),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(),
      },
      method: 'POST',
    })
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`)

    const reader = response.body?.getReader()
    if (!reader)
      return { events: [], summary: parseRunSummary([]) }

    const decoder = new TextDecoder('utf-8')
    const events = []
    let buffer = ''
    const parseLine = (line) => {
      if (!line.startsWith('data: '))
        return
      const payload = line.slice(6).trim()
      if (payload)
        events.push(JSON.parse(payload))
    }

    while (true) {
      const result = await reader.read()
      if (result.done)
        break
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      lines.forEach(parseLine)
    }
    buffer.split('\n').forEach(parseLine)

    return { events, summary: parseRunSummary(events) }
  }

  const currentAppId = (input) => input?.app_id || input?.appId || getRouteContext().route_params.app_id
  const requireAppId = (input) => {
    const appId = currentAppId(input)
    if (!appId)
      throw new Error('app_id is required when the current route is not an app page.')
    return appId
  }

  const performAction = async (input) => {
    const snapshot = getDomSnapshot({ action_limit: 500, text_limit: 0 })
    const action = snapshot.actions.find(item => item.action_id === input?.action_id)
    if (!action)
      throw new Error(`Action not found: ${input?.action_id}`)
    const element = document.querySelector(`[data-dify-agent-action-id="${action.action_id}"]`)
    if (!element)
      throw new Error(`Action element not found: ${action.action_id}`)

    if (input.action === 'fill') {
      element.focus()
      element.value = String(input.value ?? '')
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(input.value ?? '') }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    else if (input.action === 'select') {
      element.value = String(input.value ?? '')
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    else if (input.action === 'focus') {
      element.focus()
    }
    else if (input.action === 'press') {
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: String(input.key || 'Enter') }))
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(input.key || 'Enter') }))
    }
    else {
      element.click()
    }

    return { ok: true, action_id: action.action_id, action: input.action }
  }

  const definitions = [
    ['dify_get_page_context', 'Get Dify page context', 'Returns structured route, visible text, dialogs, and browser-operable action IDs.', { readOnlyHint: true }],
    ['dify_list_frontend_capabilities', 'List Dify frontend capabilities', 'Lists Dify frontend areas and what a browser agent can operate.', { readOnlyHint: true }],
    ['dify_perform_browser_action', 'Perform Dify browser action', 'Performs click, fill, select, focus, press, and toggle using action IDs.'],
    ['dify_navigate', 'Navigate within Dify', 'Navigates to a same-origin Dify path.'],
    ['dify_get_workflow_context', 'Get Dify workflow context', 'Returns workflow route context and registered page contexts when available.', { readOnlyHint: true }],
    ['dify_explain_workflow_schema', 'Explain Dify workflow schema', 'Returns workflow graph contract, node type purposes, build strategy, and debug cycle.', { readOnlyHint: true }],
    ['dify_validate_workflow_graph', 'Validate workflow graph', 'Summarizes and validates a workflow graph or current draft.', { readOnlyHint: true }],
    ['dify_get_workflow_node_default_config', 'Get workflow node default config', 'Fetches backend default config for a workflow block type.', { readOnlyHint: true }],
    ['dify_get_workflow_draft', 'Get workflow draft', 'Fetches the current app workflow draft through the authenticated console API.', { readOnlyHint: true }],
    ['dify_sync_workflow_draft', 'Sync workflow draft', 'Writes a workflow graph draft through the authenticated console API.'],
    ['dify_run_workflow_draft', 'Run workflow draft', 'Runs the workflow draft and returns parsed streaming events.'],
    ['dify_run_workflow_node', 'Run workflow node', 'Runs one draft workflow node with supplied inputs.'],
    ['dify_get_workflow_runs', 'Get workflow runs', 'Lists recent workflow runs.', { readOnlyHint: true }],
    ['dify_get_workflow_run_detail', 'Get workflow run detail', 'Fetches workflow run detail by run ID.', { readOnlyHint: true }],
    ['dify_get_workflow_run_node_executions', 'Get workflow run node executions', 'Fetches per-node execution traces for a workflow run.', { readOnlyHint: true }],
    ['dify_stop_workflow_run', 'Stop workflow run', 'Stops a running workflow task by task ID.'],
    ['dify_import_app_dsl', 'Import Dify app DSL', 'Imports a Dify YAML DSL through the authenticated console API.'],
    ['dify_publish_workflow', 'Publish workflow', 'Publishes the current or specified app workflow.'],
    ['dify_export_app_dsl', 'Export Dify app DSL', 'Exports the current or specified app YAML DSL.', { readOnlyHint: true }],
    ['dify_explain_workflow_orchestration', 'Explain Dify workflow orchestration', 'Explains how a browser agent should orchestrate Dify workflows.', { readOnlyHint: true }],
  ]

  const addTool = (name, title, description, annotations, execute) => {
    tools.set(name, { name, title, description, annotations, inputSchema: { type: 'object', properties: {} }, execute })
  }

  addTool(definitions[0][0], definitions[0][1], definitions[0][2], definitions[0][3], async input => ({
    application: { name: 'Dify', purpose: 'LLM application development platform.' },
    route: getRouteContext(),
    dom: getDomSnapshot(input || {}),
    page_contexts: Array.from(pageContexts.entries()).map(([id, provider]) => ({ id, value: provider() })),
    usage: {
      next_step: 'Use dom.actions action_id values with dify_perform_browser_action. Refresh context after navigation or UI changes.',
      no_screenshot_required: true,
    },
  }))
  addTool(definitions[1][0], definitions[1][1], definitions[1][2], definitions[1][3], async () => ({ capabilities: getCapabilities(), current_route: getRouteContext() }))
  addTool(definitions[2][0], definitions[2][1], definitions[2][2], undefined, performAction)
  addTool(definitions[3][0], definitions[3][1], definitions[3][2], undefined, async (input) => {
    const target = new URL(String(input?.path || ''), window.location.origin)
    if (target.origin !== window.location.origin)
      throw new Error('Only same-origin Dify navigation is allowed.')
    window.location.assign(`${target.pathname}${target.search}${target.hash}`)
    return { ok: true, target: `${target.pathname}${target.search}${target.hash}` }
  })
  addTool(definitions[4][0], definitions[4][1], definitions[4][2], definitions[4][3], async () => ({ route: getRouteContext(), page_contexts: Array.from(pageContexts.keys()) }))
  addTool(definitions[5][0], definitions[5][1], definitions[5][2], definitions[5][3], async () => workflowGuide())
  addTool(definitions[6][0], definitions[6][1], definitions[6][2], definitions[6][3], async input => {
    if (input?.graph)
      return { ok: true, source: 'input', graph: summarizeGraph(input.graph) }
    const appId = requireAppId(input)
    const draft = await consoleFetch(`/apps/${appId}/workflows/draft`)
    return { ok: true, app_id: appId, analysis: summarizeDraft(draft), source: 'draft' }
  })
  addTool(definitions[7][0], definitions[7][1], definitions[7][2], definitions[7][3], async input => {
    const appId = requireAppId(input)
    const blockType = input?.block_type || input?.type
    if (!blockType)
      throw new Error('block_type is required.')
    const params = new URLSearchParams({ q: JSON.stringify(input?.query || {}) })
    const result = await consoleFetch(`/apps/${appId}/workflows/default-workflow-block-configs/${blockType}?${params.toString()}`)
    return { ok: true, app_id: appId, block_type: blockType, config: result }
  })
  addTool(definitions[8][0], definitions[8][1], definitions[8][2], definitions[8][3], async input => {
    const appId = requireAppId(input)
    const draft = await consoleFetch(`/apps/${appId}/workflows/draft`)
    return { ok: true, app_id: appId, analysis: summarizeDraft(draft), draft, summary: { node_count: draft.graph?.nodes?.length || 0, edge_count: draft.graph?.edges?.length || 0, hash: draft.hash, version: draft.version } }
  })
  addTool(definitions[9][0], definitions[9][1], definitions[9][2], undefined, async input => {
    const appId = requireAppId(input)
    const result = await consoleFetch(`/apps/${appId}/workflows/draft`, { method: 'POST', body: JSON.stringify({ graph: input.graph, features: input.features || {}, hash: input.hash, environment_variables: input.environment_variables || [], conversation_variables: input.conversation_variables || [] }) })
    return { ok: result.result === 'success', app_id: appId, ...result }
  })
  addTool(definitions[10][0], definitions[10][1], definitions[10][2], undefined, async input => {
    const appId = requireAppId(input)
    const body = { inputs: input?.inputs || {} }
    if (input?.files)
      body.files = input.files
    if (input?.query !== undefined)
      body.query = input.query
    if (input?.conversation_id)
      body.conversation_id = input.conversation_id
    if (input?.parent_message_id)
      body.parent_message_id = input.parent_message_id
    const path = input?.app_mode === 'advanced-chat'
      ? `/apps/${appId}/advanced-chat/workflows/draft/run`
      : `/apps/${appId}/workflows/draft/run`
    const result = await runWorkflowSse(path, body)
    return { ok: result.summary.status !== 'error', app_id: appId, events: result.events, summary: result.summary }
  })
  addTool(definitions[11][0], definitions[11][1], definitions[11][2], undefined, async input => {
    const appId = requireAppId(input)
    if (!input?.node_id)
      throw new Error('node_id is required.')
    const result = await consoleFetch(`/apps/${appId}/workflows/draft/nodes/${input.node_id}/run`, { method: 'POST', body: JSON.stringify({ inputs: input.inputs || {}, query: input.query || '', files: input.files }) })
    return { ok: true, app_id: appId, node_id: input.node_id, result }
  })
  addTool(definitions[12][0], definitions[12][1], definitions[12][2], definitions[12][3], async input => {
    const appId = requireAppId(input)
    const params = new URLSearchParams({ limit: String(input?.limit || 20) })
    if (input?.last_id)
      params.set('last_id', input.last_id)
    if (input?.status)
      params.set('status', input.status)
    if (input?.triggered_from)
      params.set('triggered_from', input.triggered_from)
    const result = await consoleFetch(`/apps/${appId}/workflow-runs?${params.toString()}`)
    return { ok: true, app_id: appId, ...result }
  })
  addTool(definitions[13][0], definitions[13][1], definitions[13][2], definitions[13][3], async input => {
    const appId = requireAppId(input)
    const runId = input?.run_id || input?.workflow_run_id
    if (!runId)
      throw new Error('run_id is required.')
    const result = await consoleFetch(`/apps/${appId}/workflow-runs/${runId}`)
    return { ok: true, app_id: appId, run_id: runId, detail: result }
  })
  addTool(definitions[14][0], definitions[14][1], definitions[14][2], definitions[14][3], async input => {
    const appId = requireAppId(input)
    const runId = input?.run_id || input?.workflow_run_id
    if (!runId)
      throw new Error('run_id is required.')
    const result = await consoleFetch(`/apps/${appId}/workflow-runs/${runId}/node-executions`)
    return { ok: true, app_id: appId, run_id: runId, ...result }
  })
  addTool(definitions[15][0], definitions[15][1], definitions[15][2], undefined, async input => {
    const appId = requireAppId(input)
    if (!input?.task_id)
      throw new Error('task_id is required.')
    const result = await consoleFetch(`/apps/${appId}/workflow-runs/tasks/${input.task_id}/stop`, { method: 'POST', body: '{}' })
    return { ok: result.result === 'success', app_id: appId, task_id: input.task_id, ...result }
  })
  addTool(definitions[16][0], definitions[16][1], definitions[16][2], undefined, async input => {
    let result = await consoleFetch('/apps/imports', { method: 'POST', body: JSON.stringify({ mode: 'yaml-content', yaml_content: input?.yaml_content, name: input?.name, description: input?.description, app_id: input?.app_id }) })
    if (result.status === 'pending' && input?.auto_confirm_version_mismatch !== false)
      result = await consoleFetch(`/apps/imports/${result.id}/confirm`, { method: 'POST', body: '{}' })
    if (result.app_id && input?.navigate_to_workflow !== false)
      window.location.assign(`/app/${result.app_id}/workflow`)
    return { ok: result.status === 'completed' || result.status === 'completed-with-warnings', app_id: result.app_id || null, ...result }
  })
  addTool(definitions[17][0], definitions[17][1], definitions[17][2], undefined, async input => {
    const appId = requireAppId(input)
    const result = await consoleFetch(`/apps/${appId}/workflows/publish`, { method: 'POST', body: JSON.stringify({ marked_name: String(input?.marked_name || '').slice(0, 20), marked_comment: String(input?.marked_comment || '').slice(0, 100) }) })
    return { ok: result.result === 'success', app_id: appId, ...result }
  })
  addTool(definitions[18][0], definitions[18][1], definitions[18][2], definitions[18][3], async input => {
    const appId = requireAppId(input)
    const params = new URLSearchParams({ include_secret: input?.include_secret ? 'true' : 'false' })
    if (input?.workflow_id)
      params.set('workflow_id', input.workflow_id)
    const result = await consoleFetch(`/apps/${appId}/export?${params.toString()}`)
    return { ok: true, app_id: appId, yaml_content: result.data }
  })
  addTool(definitions[19][0], definitions[19][1], definitions[19][2], definitions[19][3], async () => ({
    purpose: 'Operate Dify workflow builder through structured context instead of screenshots.',
    recommended_loop: ['Call dify_explain_workflow_schema.', 'Search/install plugins with dify_search_marketplace_plugins and dify_install_marketplace_plugins.', 'List installed plugin capabilities.', 'Fetch default node configs with dify_get_workflow_node_default_config.', 'Call dify_get_workflow_context.', 'Validate with dify_validate_workflow_graph.', 'Run with dify_run_workflow_draft.', 'Inspect with dify_get_workflow_run_node_executions.', 'Iterate, then publish.'],
  }))

  addTool('dify_create_workflow_app', 'Create workflow app', 'Creates a workflow app through the authenticated console API.', undefined, async input => {
    const result = await consoleFetch('/apps', { method: 'POST', body: JSON.stringify({ name: input?.name || 'Untitled workflow', mode: 'workflow', description: input?.description, icon_type: 'emoji', icon: input?.icon || '🤖', icon_background: input?.icon_background || '#D5F5F6' }) })
    if (result.id && input?.navigate_to_workflow !== false)
      window.location.assign(`/app/${result.id}/workflow`)
    return { ok: true, app_id: result.id, app_url: result.id ? `/app/${result.id}/workflow` : null, app: result }
  })

  const financeRecipe = {
    id: 'finance-credit-first-management',
    title: 'Credit-first finance automation from Mercury to QuickBooks',
    summary: 'Plugin-aware Mercury transaction trigger, Mercury enrichment, deterministic finance controls, human review for exceptions, and QuickBooks posting.',
    required_plugins: ['petrus/mercury_trigger', 'petrus/mercury_tools', 'petrus/quickbooks'],
    required_block_types: ['trigger-plugin', 'tool', 'code', 'llm', 'if-else', 'human-input', 'template-transform', 'end'],
  }

  addTool('dify_list_workflow_recipes', 'List workflow recipes', 'Lists known workflow construction recipes.', { readOnlyHint: true }, async () => ({ recipes: [financeRecipe] }))
  addTool('dify_get_workflow_recipe', 'Get workflow recipe', 'Returns the plugin-aware finance workflow recipe.', { readOnlyHint: true }, async () => ({ ok: true, recipe: financeRecipe }))
  addTool('dify_build_workflow_recipe_plan', 'Build workflow recipe plan', 'Returns a build/debug/publish plan for the finance workflow recipe.', { readOnlyHint: true }, async () => ({
    ok: true,
    plan: {
      authoring_loop: ['Discover Marketplace plugins.', 'Install missing plugins.', 'List installed trigger and tool capabilities.', 'Create workflow app.', 'Construct graph with Mercury trigger-plugin and QuickBooks tool nodes.', 'Sync draft.', 'Validate graph.', 'Debug plugin credentials/subscriptions.', 'Publish and enable trigger.'],
      required_block_config_calls: financeRecipe.required_block_types.map(block_type => ({ block_type, tool: 'dify_get_workflow_node_default_config' })),
    },
    recipe_id: financeRecipe.id,
  }))

  addTool('dify_search_marketplace_plugins', 'Search Marketplace plugins', 'Searches Dify Marketplace for trigger/tool plugins.', { readOnlyHint: true, untrustedContentHint: true }, async input => {
    const body = { page: input?.page || 1, page_size: input?.page_size || 10, query: input?.query || '', type: input?.type || 'plugin' }
    if (input?.category)
      body.category = input.category
    const result = await marketplaceFetch('/plugins/search/advanced', { method: 'POST', body: JSON.stringify(body) })
    const data = result.data || result
    return { ok: true, page: data.page || body.page, page_size: data.page_size || body.page_size, plugins: data.plugins || [], query: body, total: data.total || 0 }
  })

  addTool('dify_list_installed_plugin_capabilities', 'List installed plugin capabilities', 'Lists installed plugin packages plus available tool and trigger providers.', { readOnlyHint: true }, async input => {
    const appId = currentAppId(input)
    const safe = async (path) => {
      try { return { ok: true, data: await consoleFetch(path) } }
      catch (error) { return { ok: false, error: String(error?.message || error) } }
    }
    const [plugins, triggers, builtin, custom, workflow, mcp, appTriggers] = await Promise.all([
      safe('/workspaces/current/plugin/list?page=1&page_size=100'),
      safe('/workspaces/current/triggers'),
      safe('/workspaces/current/tools/builtin'),
      safe('/workspaces/current/tools/api'),
      safe('/workspaces/current/tools/workflow'),
      safe('/workspaces/current/tools/mcp'),
      appId ? safe(`/apps/${appId}/triggers`) : Promise.resolve({ ok: true, data: null }),
    ])
    return { ok: true, app_id: appId || null, catalog: { app_triggers: appTriggers.data, installed_plugins: plugins.data, tools: { builtin: builtin.data, custom: custom.data, mcp: mcp.data, workflow: workflow.data }, triggers: triggers.data }, request_status: { appTriggers, builtin, custom, mcp, plugins, triggers, workflow } }
  })

  addTool('dify_get_plugin_readme', 'Get plugin README', 'Fetches installed plugin README content.', { readOnlyHint: true, untrustedContentHint: true }, async input => {
    const identifier = input?.plugin_unique_identifier || input?.unique_identifier
    if (!identifier)
      throw new Error('plugin_unique_identifier is required.')
    const params = new URLSearchParams({ plugin_unique_identifier: identifier })
    if (input?.language)
      params.set('language', input.language)
    const result = await consoleFetch(`/workspaces/current/plugin/readme?${params.toString()}`)
    return { ok: true, plugin_unique_identifier: identifier, readme: result.readme || '' }
  })

  addTool('dify_install_marketplace_plugins', 'Install Marketplace plugins', 'Installs one or more Marketplace plugin packages.', undefined, async input => {
    const identifiers = input?.plugin_unique_identifiers || input?.unique_identifiers || (input?.plugin_unique_identifier ? [input.plugin_unique_identifier] : [])
    if (!identifiers.length)
      throw new Error('plugin_unique_identifiers is required.')
    const result = await consoleFetch('/workspaces/current/plugin/install/marketplace', { method: 'POST', body: JSON.stringify({ plugin_unique_identifiers: identifiers }) })
    return { ok: result.all_installed === true || !!result.task_id, plugin_unique_identifiers: identifiers, ...result }
  })
  addTool('dify_get_plugin_install_tasks', 'Get plugin install tasks', 'Lists plugin install/upgrade tasks.', { readOnlyHint: true }, async () => ({ ok: true, ...await consoleFetch('/workspaces/current/plugin/tasks?page=1&page_size=100') }))

  addTool('dify_get_trigger_provider_detail', 'Get trigger provider detail', 'Fetches trigger provider info and subscriptions.', { readOnlyHint: true }, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    if (!provider)
      throw new Error('provider is required.')
    const safe = async (path) => {
      try { return { ok: true, data: await consoleFetch(path) } }
      catch (error) { return { ok: false, error: String(error?.message || error) } }
    }
    const encoded = encodeURIComponent(provider)
    const [info, subscriptions] = await Promise.all([safe(`/workspaces/current/trigger-provider/${encoded}/info`), safe(`/workspaces/current/trigger-provider/${encoded}/subscriptions/list`)])
    return { ok: info.ok || subscriptions.ok, provider, info: info.data || null, subscriptions: subscriptions.data || [], raw: { info, subscriptions } }
  })

  addTool('dify_create_trigger_subscription_builder', 'Create trigger subscription builder', 'Creates a trigger subscription builder.', undefined, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    if (!provider)
      throw new Error('provider is required.')
    return { ok: true, provider, ...await consoleFetch(`/workspaces/current/trigger-provider/${encodeURIComponent(provider)}/subscriptions/builder/create`, { method: 'POST', body: JSON.stringify({ credential_type: input?.credential_type }) }) }
  })
  addTool('dify_update_trigger_subscription_builder', 'Update trigger subscription builder', 'Updates trigger subscription builder credentials, properties, or parameters.', undefined, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    const id = input?.subscription_builder_id || input?.subscriptionBuilderId
    if (!provider || !id)
      throw new Error('provider and subscription_builder_id are required.')
    const body = { credentials: input?.credentials, name: input?.name, parameters: input?.parameters, properties: input?.properties }
    return { ok: true, provider, subscription_builder_id: id, ...await consoleFetch(`/workspaces/current/trigger-provider/${encodeURIComponent(provider)}/subscriptions/builder/update/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) }) }
  })
  addTool('dify_verify_trigger_subscription_builder', 'Verify trigger subscription builder', 'Verifies trigger subscription builder credentials.', undefined, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    const id = input?.subscription_builder_id || input?.subscriptionBuilderId
    if (!provider || !id)
      throw new Error('provider and subscription_builder_id are required.')
    const result = await consoleFetch(`/workspaces/current/trigger-provider/${encodeURIComponent(provider)}/subscriptions/builder/verify-and-update/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ credentials: input?.credentials || {} }) })
    return { ok: result.verified === true, provider, subscription_builder_id: id, ...result }
  })
  addTool('dify_build_trigger_subscription', 'Build trigger subscription', 'Builds a trigger subscription from a verified builder.', undefined, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    const id = input?.subscription_builder_id || input?.subscriptionBuilderId
    if (!provider || !id)
      throw new Error('provider and subscription_builder_id are required.')
    return { ok: true, provider, subscription_builder_id: id, ...await consoleFetch(`/workspaces/current/trigger-provider/${encodeURIComponent(provider)}/subscriptions/builder/build/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ name: input?.name, parameters: input?.parameters }) }) }
  })
  addTool('dify_get_trigger_subscription_builder_logs', 'Get trigger subscription builder logs', 'Fetches trigger subscription builder logs.', { readOnlyHint: true }, async input => {
    const provider = input?.provider || input?.provider_id || input?.provider_name
    const id = input?.subscription_builder_id || input?.subscriptionBuilderId
    if (!provider || !id)
      throw new Error('provider and subscription_builder_id are required.')
    return { ok: true, provider, subscription_builder_id: id, ...await consoleFetch(`/workspaces/current/trigger-provider/${encodeURIComponent(provider)}/subscriptions/builder/logs/${encodeURIComponent(id)}`) }
  })

  addTool('dify_get_plugin_dynamic_options', 'Get plugin dynamic options', 'Fetches dynamic options for plugin parameters.', { readOnlyHint: true }, async input => {
    const params = new URLSearchParams()
    ;['plugin_id', 'provider', 'action', 'parameter', 'provider_type'].forEach((key) => {
      if (input?.[key])
        params.set(key, input[key])
    })
    if (!params.get('plugin_id') || !params.get('provider') || !params.get('action') || !params.get('parameter'))
      throw new Error('plugin_id, provider, action, and parameter are required.')
    if (input?.extra) {
      Object.entries(input.extra).forEach(([key, value]) => {
        if (['string', 'number', 'boolean'].includes(typeof value))
          params.set(key, String(value))
      })
    }
    return { ok: true, ...await consoleFetch(`/workspaces/current/plugin/parameters/dynamic-options?${params.toString()}`) }
  })
  addTool('dify_get_app_triggers', 'Get app triggers', 'Lists trigger records for a published workflow app.', { readOnlyHint: true }, async input => {
    const appId = requireAppId(input)
    return { ok: true, app_id: appId, ...await consoleFetch(`/apps/${appId}/triggers`) }
  })
  addTool('dify_set_app_trigger_enabled', 'Enable or disable app trigger', 'Enables or disables a published app trigger record.', undefined, async input => {
    const appId = requireAppId(input)
    if (!input?.trigger_id)
      throw new Error('trigger_id is required.')
    return { ok: true, app_id: appId, ...await consoleFetch(`/apps/${appId}/trigger-enable`, { method: 'POST', body: JSON.stringify({ enable_trigger: input.enable_trigger !== false, trigger_id: input.trigger_id }) }) }
  })

  const normalizeTestingInput = (input) => {
    if (typeof input !== 'string')
      return input || {}

    if (!input)
      return {}

    const value = JSON.parse(input)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return {}

    return value
  }

  const api = {
    version: VERSION,
    callTool: async (name, input) => {
      const tool = tools.get(name)
      if (!tool)
        throw new Error(`Dify agent tool "${name}" is not registered.`)
      return tool.execute(input || {})
    },
    getPageContext: () => api.callTool('dify_get_page_context', {}),
    listTools: () => Array.from(tools.values()).map(({ execute, ...tool }) => tool),
    registerPageContext: (id, provider) => {
      pageContexts.set(id, provider)
      return () => {
        if (pageContexts.get(id) === provider)
          pageContexts.delete(id)
      }
    },
  }

  window.__DIFY_AGENT_CONTEXT__ = api

  if (!navigator.modelContextTesting) {
    try {
      Object.defineProperty(navigator, 'modelContextTesting', {
        configurable: true,
        value: {
          executeTool: (name, input) => api.callTool(name, normalizeTestingInput(input)),
          listTools: () => api.listTools(),
        },
      })
    }
    catch (error) {
      console.warn('[Dify Agent Context] WebMCP testing API registration failed:', error)
    }
  }

  // The React runtime registers the full hydrated toolset with WebMCP. This
  // early fallback only exposes a same-origin window API before hydration.
})()
