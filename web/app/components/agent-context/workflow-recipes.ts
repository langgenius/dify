'use client'

import type { AgentToolResult } from './types'
import { BlockEnum } from '@/app/components/workflow/types'

type WorkflowRecipe = {
  app_mode: string
  build_notes: string[]
  edge_blueprint: Array<Record<string, string>>
  hard_controls: string[]
  id: string
  input_contract: Array<Record<string, string | boolean>>
  node_blueprint: Array<Record<string, string>>
  output_contract: Array<Record<string, string>>
  prerequisites: string[]
  source: {
    published_at: string
    title: string
    url: string
  }
  summary: string
  test_cases: Array<Record<string, string | Record<string, unknown>>>
  title: string
}

const FINANCE_CREDIT_FIRST_RECIPE: WorkflowRecipe = {
  app_mode: 'workflow',
  build_notes: [
    'Keep the workflow deterministic around financial controls; use LLM only for bounded classification and explanation.',
    'Use Marketplace plugin discovery first: install Mercury Trigger, Mercury Banking Tools, and QuickBooks Online Accounting if they are absent.',
    'Use the Mercury trigger-plugin node as the entry point; do not model Mercury events as a generic HTTP request when the plugin is available.',
    'Use QuickBooks tool nodes for accounting writes; do not hand-roll QuickBooks REST calls unless the plugin is unavailable.',
    'Fetch default configs for every block type before writing node data.',
    'Use if-else rules for review thresholds instead of letting the LLM decide whether to bypass controls.',
    'Persist the classification basis, final route, external posting result, and human review result as audit evidence.',
  ],
  edge_blueprint: [
    { from: 'mercury_transaction_trigger', to: 'fetch_transaction', route: 'new_or_updated_transaction' },
    { from: 'fetch_transaction', to: 'normalize_transaction', route: 'success' },
    { from: 'normalize_transaction', to: 'lookup_context', route: 'success' },
    { from: 'lookup_context', to: 'classify_transaction', route: 'success' },
    { from: 'classify_transaction', to: 'risk_gate', route: 'success' },
    { from: 'risk_gate', to: 'post_to_quickbooks', route: 'direct_pass' },
    { from: 'risk_gate', to: 'create_pending_entry', route: 'review_required' },
    { from: 'create_pending_entry', to: 'finance_review', route: 'success' },
    { from: 'finance_review', to: 'post_to_quickbooks', route: 'approved' },
    { from: 'post_to_quickbooks', to: 'audit_summary', route: 'success' },
    { from: 'audit_summary', to: 'end', route: 'success' },
  ],
  hard_controls: [
    'Route new suppliers to review unless an allow-list rule explicitly permits direct posting.',
    'Route large transactions to review using a configured amount threshold.',
    'Route sensitive accounts, low confidence classifications, missing notes, and malformed transactions to review.',
    'Never post to QuickBooks without a deterministic route decision and stored audit basis.',
    'Stop or fail closed when Mercury, context lookup, or QuickBooks API calls return ambiguous data.',
  ],
  id: 'finance-credit-first-management',
  input_contract: [
    { name: 'event_id', required: true, source: 'Mercury trigger output', type: 'string' },
    { name: 'transaction_id', required: true, source: 'Mercury trigger output', type: 'string' },
    { name: 'account_id', required: true, source: 'Mercury trigger output', type: 'string' },
    { name: 'amount', required: true, source: 'Mercury trigger output', type: 'number' },
    { name: 'status', required: true, source: 'Mercury trigger output', type: 'string' },
    { name: 'operation_type', required: true, source: 'Mercury trigger output', type: 'string' },
  ],
  node_blueprint: [
    { id: 'mercury_transaction_trigger', plugin: 'petrus/mercury_trigger', provider: 'petrus/mercury_trigger/mercury_trigger', purpose: 'Subscribe to Mercury transaction.created and transaction.updated webhook events.', title: 'Mercury Transaction Trigger', type: BlockEnum.TriggerPlugin },
    { id: 'fetch_transaction', plugin: 'petrus/mercury_tools', provider: 'petrus/mercury_tools/mercury_tools', purpose: 'Fetch Mercury transaction details: amount, merchant, notes, time, and cardholder.', title: 'Fetch Mercury Transaction', tool: 'get_transaction', type: BlockEnum.Tool },
    { id: 'normalize_transaction', purpose: 'Normalize merchant names, amounts, memo text, and missing optional fields.', title: 'Normalize Transaction', type: BlockEnum.Code },
    { id: 'lookup_context', purpose: 'Resolve cost center and retrieve supplier historical bookkeeping habits.', title: 'Lookup Context', type: BlockEnum.Tool },
    { id: 'classify_transaction', purpose: 'Suggest account classification, confidence, risk flags, and reasoning basis.', title: 'Finance Classification', type: BlockEnum.LLM },
    { id: 'risk_gate', purpose: 'Apply deterministic controls for direct pass versus finance review.', title: 'Risk Gate', type: BlockEnum.IfElse },
    { id: 'create_pending_entry', purpose: 'Create a pending bookkeeping entry and notify finance for exception review.', title: 'Create Pending Entry', type: BlockEnum.Tool },
    { id: 'finance_review', purpose: 'Collect finance approval, corrected account, and reviewer notes.', title: 'Finance Review', type: BlockEnum.HumanInput },
    { id: 'post_to_quickbooks', plugin: 'petrus/quickbooks', provider: 'petrus/quickbooks/quickbooks', purpose: 'Write the approved expense or journal entry to QuickBooks.', title: 'Post to QuickBooks', tool: 'create_purchase', type: BlockEnum.Tool },
    { id: 'audit_summary', purpose: 'Render a compact audit record with inputs, route, basis, reviewer, and external ids.', title: 'Audit Summary', type: BlockEnum.TemplateTransform },
    { id: 'end', purpose: 'Return posting status, route, audit summary, and follow-up action.', title: 'End', type: BlockEnum.End },
  ],
  output_contract: [
    { name: 'route', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'account_code', type: 'string' },
    { name: 'confidence', type: 'number' },
    { name: 'basis', type: 'string' },
    { name: 'quickbooks_entry_id', type: 'string' },
    { name: 'audit_summary', type: 'string' },
  ],
  prerequisites: [
    'Installed Marketplace plugin: petrus/mercury_trigger with a verified subscription for transaction events.',
    'Installed Marketplace plugin: petrus/mercury_tools with Mercury Banking credentials for transaction enrichment.',
    'Installed Marketplace plugin: petrus/quickbooks with QuickBooks Online credentials for accounting writes.',
    'Cardholder-to-department or cost-center mapping.',
    'Supplier history lookup source, such as dataset, internal API, or tool.',
    'QuickBooks account ids for bank account, expense account, and optional vendor mapping, plus idempotency key strategy.',
    'Finance reviewer notification channel and human-input form ownership.',
  ],
  source: {
    published_at: '2026-02-17',
    title: 'Finance Automation in Action: How to Solve the "Credit First" Management Challenge with Dify Workflow',
    url: 'https://dify.ai/blog/finance-automation-in-action-how-to-solve-the-credit-first-management-challenge-with-dify-workflow',
  },
  summary: 'Routes Mercury card transactions into QuickBooks with deterministic financial controls, LLM-assisted classification, review handling for exceptions, and auditable execution records.',
  test_cases: [
    {
      expected_route: 'direct_pass',
      id: 'known_subscription_low_risk',
      inputs: { amount: 49, merchant_name: 'Known SaaS Vendor', memo: 'monthly subscription' },
      purpose: 'Known fixed-pattern transaction posts automatically.',
    },
    {
      expected_route: 'review_required',
      id: 'new_supplier',
      inputs: { amount: 320, merchant_name: 'New Vendor LLC', memo: 'team tooling' },
      purpose: 'New supplier is held for review even when the LLM classification is plausible.',
    },
    {
      expected_route: 'review_required',
      id: 'large_transaction',
      inputs: { amount: 12000, merchant_name: 'Cloud Provider', memo: 'annual commit' },
      purpose: 'High amount crosses the deterministic manual review threshold.',
    },
    {
      expected_route: 'review_required',
      id: 'sensitive_or_low_confidence',
      inputs: { amount: 900, merchant_name: 'Consulting Partner', memo: '' },
      purpose: 'Missing context or sensitive account flags must route to review.',
    },
  ],
  title: 'Credit-first finance automation from Mercury to QuickBooks',
}

export const WORKFLOW_RECIPES = [
  FINANCE_CREDIT_FIRST_RECIPE,
]

export const listWorkflowRecipes = (): AgentToolResult => ({
  recipes: WORKFLOW_RECIPES.map(recipe => ({
    app_mode: recipe.app_mode,
    id: recipe.id,
    required_block_types: Array.from(new Set(recipe.node_blueprint.map(node => node.type))),
    source: recipe.source,
    summary: recipe.summary,
    title: recipe.title,
  })),
})

export const getWorkflowRecipeById = (recipeId?: string) => {
  const id = recipeId || FINANCE_CREDIT_FIRST_RECIPE.id
  const recipe = WORKFLOW_RECIPES.find(recipe => recipe.id === id)
  if (!recipe)
    throw new Error(`Unknown workflow recipe "${id}".`)

  return recipe
}

export const getWorkflowRecipeForAgent = (recipeId?: string): AgentToolResult => {
  return {
    ok: true,
    recipe: getWorkflowRecipeById(recipeId),
  }
}

export const buildWorkflowRecipePlan = (recipeId?: string): AgentToolResult => {
  const recipe = getWorkflowRecipeById(recipeId)
  const requiredBlockTypes = Array.from(new Set(recipe.node_blueprint.map(node => node.type)))

  return {
    ok: true,
    plan: {
      authoring_loop: [
        'Open or create the target workflow app.',
        'Call dify_get_workflow_node_default_config for each required block type.',
        'Assemble the graph from the recipe blueprint using backend default configs as the base for node data.',
        'Call dify_sync_workflow_draft or dify_import_app_dsl with the complete graph.',
        'Call dify_validate_workflow_graph and fix structural issues before running.',
        'Run every recipe test case with dify_run_workflow_draft.',
        'Inspect dify_get_workflow_run_detail and dify_get_workflow_run_node_executions for each run.',
        'Publish only after direct-pass, review-required, and failure/edge-case paths all behave as expected.',
      ],
      publish_gate: [
        'No dangling or unreachable nodes.',
        'Every deterministic hard control is represented by a branch condition or explicit failure path.',
        'Every external write has an idempotency key or duplicate protection note.',
        'Audit output contains route, inputs, classification basis, reviewer result when present, and external ids.',
      ],
      required_block_config_calls: requiredBlockTypes.map(blockType => ({
        block_type: blockType,
        tool: 'dify_get_workflow_node_default_config',
      })),
      run_matrix: recipe.test_cases.map(testCase => ({
        expected_route: testCase.expected_route,
        inputs: testCase.inputs,
        test_case_id: testCase.id,
        tool: 'dify_run_workflow_draft',
      })),
    },
    recipe_id: recipe.id,
  }
}
