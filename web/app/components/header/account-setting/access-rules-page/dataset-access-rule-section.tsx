import type { PermissionSetFormValues, PermissionSetModalMode } from './permission-set-modal'
import type { AccessPolicyWithBindings } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import {
  useCreateAccessRule,
  useInfiniteWorkspaceDatasetAccessRules,
  useUpdateAccessRule,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRuleSection from './access-rule-section'
import PermissionSetModal from './permission-set-modal'

type DatasetAccessRuleSectionProps = {
  className?: string
}

type PermissionSetModalState = {
  mode: PermissionSetModalMode
  ruleId?: string
  initialValues?: PermissionSetFormValues
}

const RULES_PER_PAGE = 20

const DatasetAccessRuleSection = ({
  className,
}: DatasetAccessRuleSectionProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [permissionSetModalState, setPermissionSetModalState] = useState<PermissionSetModalState | null>(null)
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

  const {
    data: datasetAccessRulesResponse,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteWorkspaceDatasetAccessRules({
    page: 1,
    limit: RULES_PER_PAGE,
    language,
  })
  const { mutateAsync: createAccessRule } = useCreateAccessRule()
  const { mutateAsync: updateAccessRule } = useUpdateAccessRule()

  const datasetAccessRules = useMemo(() => datasetAccessRulesResponse?.pages.flatMap(page => page.items) || [], [datasetAccessRulesResponse?.pages])
  const totalCount = datasetAccessRulesResponse?.pages[0]?.pagination.total_count || 0

  const closePermissionSetModal = useCallback(() => {
    setPermissionSetModalState(null)
  }, [])

  const handleCreate = useCallback(() => {
    setPermissionSetModalState({ mode: 'create' })
  }, [])

  const handleView = useCallback((rule: AccessPolicyWithBindings) => {
    const { policy } = rule
    setPermissionSetModalState({
      mode: 'view',
      initialValues: {
        name: policy.name,
        description: policy.description,
        permissionKeys: policy.permission_keys,
      },
    })
  }, [])

  const handleEdit = useCallback((rule: AccessPolicyWithBindings) => {
    const { policy } = rule
    setPermissionSetModalState({
      mode: 'edit',
      ruleId: policy.id,
      initialValues: {
        name: policy.name,
        description: policy.description,
        permissionKeys: policy.permission_keys,
      },
    })
  }, [])

  const handlePermissionSetSubmit = useCallback((values: PermissionSetFormValues) => {
    if (!permissionSetModalState)
      return

    const { name, description, permissionKeys } = values
    if (permissionSetModalState.mode === 'create') {
      createAccessRule({
        name,
        description,
        permission_keys: permissionKeys,
        resourceType: 'dataset',
      }, {
        onSuccess: () => {
          toast.success(t('accessRule.created', { ns: 'permission' }))
          closePermissionSetModal()
        },
      })
    }
    else if (permissionSetModalState.mode === 'edit') {
      updateAccessRule({
        id: permissionSetModalState.ruleId!,
        name,
        description,
        permission_keys: permissionKeys,
        resourceType: 'dataset',
      }, {
        onSuccess: () => {
          toast.success(t('accessRule.updated', { ns: 'permission' }))
          closePermissionSetModal()
        },
      })
    }
  }, [closePermissionSetModal, createAccessRule, permissionSetModalState, t, updateAccessRule])

  return (
    <>
      <AccessRuleSection
        title={t('accessRule.datasetTitle', { ns: 'permission' })}
        rules={datasetAccessRules}
        totalCount={totalCount}
        isLoadingRules={isLoading}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        error={error}
        onCreate={handleCreate}
        onViewRule={handleView}
        onEditRule={handleEdit}
        className={className}
      />
      {permissionSetModalState && (
        <PermissionSetModal
          open
          mode={permissionSetModalState.mode}
          resourceType="dataset"
          initialValues={permissionSetModalState.initialValues}
          onClose={closePermissionSetModal}
          onSubmit={handlePermissionSetSubmit}
        />
      )}
    </>
  )
}

export default DatasetAccessRuleSection
