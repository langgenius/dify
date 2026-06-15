import type { AccessPolicyWithBindings } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import AccessRulesEditor from '../index'

const createRule = (resourceType: 'app' | 'dataset'): AccessPolicyWithBindings => ({
  policy: {
    id: `${resourceType}-policy-id`,
    tenant_id: 'tenant-id',
    resource_type: resourceType,
    policy_key: `${resourceType}-policy-key`,
    name: `${resourceType} policy`,
    description: `${resourceType} policy description`,
    permission_keys: [],
    is_builtin: false,
    category: 'global_custom',
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
  },
  roles: [],
  accounts: [],
})

describe('AccessRulesEditor', () => {
  it('should render the resource access rules panel summary and rows', () => {
    const rule = createRule('app')
    rule.roles = [{
      role_id: 'role-1',
      role_name: 'App Editor',
      binding_id: 'role-binding-1',
      is_locked: true,
      role_tag: '',
    }]
    rule.accounts = [{
      account_id: 'member-1',
      account_name: 'Levi',
      binding_id: 'member-binding-1',
      is_locked: false,
    }]

    render(
      <AccessRulesEditor
        title="App access rules"
        rules={[rule]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'App access rules' })).toBeInTheDocument()
    expect(screen.getByText(/permission\.accessRule\.summary/)).toHaveTextContent('"count":1')
    expect(screen.getByText(/permission\.accessRule\.lockedSummary/)).toHaveTextContent('"count":1')
    expect(screen.getByText('app policy')).toBeInTheDocument()
    expect(screen.getByText('app policy description')).toBeInTheDocument()
  })

  it('should render loading state before empty or row content', () => {
    render(
      <AccessRulesEditor
        title="App access rules"
        rules={[]}
        isLoadingRules
      />,
    )

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(screen.queryByText('permission.accessRule.noRules')).not.toBeInTheDocument()
  })

  it('should render empty state when there are no rules', () => {
    render(
      <AccessRulesEditor
        title="App access rules"
        rules={[]}
      />,
    )

    expect(screen.getByText('permission.accessRule.noRules')).toBeInTheDocument()
  })
})
