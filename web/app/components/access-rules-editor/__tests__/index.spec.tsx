import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccessRulesEditor from '../index'

const updateAppAccessRuleBindingsMock = vi.fn()
const updateDatasetAccessRuleBindingsMock = vi.fn()

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: 'route-app-id' }),
}))

vi.mock('@/service/access-control/use-app-access-config', () => ({
  useUpdateAppAccessRuleBindings: () => ({
    mutateAsync: updateAppAccessRuleBindingsMock,
  }),
}))

vi.mock('@/service/access-control/use-dataset-access-config', () => ({
  useUpdateDatasetAccessRuleBindings: () => ({
    mutateAsync: updateDatasetAccessRuleBindingsMock,
  }),
}))

vi.mock('@/app/components/header/account-setting/access-rules-page/access-rule-row', () => ({
  default: ({
    rule,
    canManage,
    onAddRole,
    onRemove,
  }: {
    rule: AccessPolicyWithBindings
    canManage: boolean
    onAddRole?: (rule: AccessPolicyWithBindings) => void
    onRemove?: (payload: RemoveBindingPayload) => void
  }) => (
    <div>
      <span>{rule.policy.name}</span>
      {canManage && (
        <>
          <button type="button" onClick={() => onAddRole?.(rule)}>
            Add target
          </button>
          <button
            type="button"
            onClick={() => onRemove?.({
              policy_id: rule.policy.id,
              resource_type: rule.policy.resource_type,
              role_ids: [],
              account_ids: [],
            })}
          >
            Remove target
          </button>
        </>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal', () => ({
  default: ({ onSubmit }: { onSubmit: (selection: { roleIds: string[], memberIds: string[] }) => void }) => (
    <button
      type="button"
      onClick={() => onSubmit({ roleIds: ['role-new'], memberIds: ['member-new'] })}
    >
      Confirm add target
    </button>
  ),
}))

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

describe('AccessRulesEditor resource bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update dataset bindings with the provided resource id', async () => {
    render(
      <AccessRulesEditor
        resourceId="dataset-resource-id"
        rules={[createRule('dataset')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add target' }))

    await waitFor(() => {
      expect(updateDatasetAccessRuleBindingsMock).toHaveBeenCalledWith({
        datasetId: 'dataset-resource-id',
        policyId: 'dataset-policy-id',
        role_ids: ['role-new'],
        account_ids: ['member-new'],
      }, expect.any(Object))
    })
  })

  it('should update app bindings with the provided resource id', async () => {
    render(
      <AccessRulesEditor
        resourceId="app-resource-id"
        rules={[createRule('app')]}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove target' }))

    await waitFor(() => {
      expect(updateAppAccessRuleBindingsMock).toHaveBeenCalledWith({
        appId: 'app-resource-id',
        policyId: 'app-policy-id',
        role_ids: [],
        account_ids: [],
      }, expect.any(Object))
    })
  })
})
