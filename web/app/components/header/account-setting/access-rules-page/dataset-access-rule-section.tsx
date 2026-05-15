import type { AccessPolicyWithBindings } from '@/models/access-control'
import { useWorkspaceDatasetAccessRules } from '@/service/access-control/use-workspace-access-rules'
import AccessRuleSection from './access-rule-section'

type DatasetAccessRuleSectionProps = {
  className?: string
  onCreate?: () => void
  onEditRule?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
}

const DatasetAccessRuleSection = ({
  className,
  onCreate,
  onEditRule,
  onAddRole,
}: DatasetAccessRuleSectionProps) => {
  const { data: datasetAccessRulesResponse, isLoading } = useWorkspaceDatasetAccessRules({
    page: 1,
    limit: 20,
  })

  const datasetAccessRules = datasetAccessRulesResponse?.items || []

  return (
    <AccessRuleSection
      title="Knowledge Base Access Rules"
      rules={datasetAccessRules}
      isLoadingRules={isLoading}
      onCreate={onCreate}
      onEditRule={onEditRule}
      onAddRole={onAddRole}
      className={className}
    />
  )
}

export default DatasetAccessRuleSection
