import type { AccessPolicyWithBindings } from '@/models/access-control'
import {
  useWorkspaceAppAccessRules,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRuleSection from './access-rule-section'

type AppAccessRuleSectionProps = {
  className?: string
  onCreate?: () => void
  onEditRule?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
}

const AppAccessRuleSection = ({
  className,
  onCreate,
  onEditRule,
  onAddRole,
}: AppAccessRuleSectionProps) => {
  const { data: appAccessRulesResponse, isLoading } = useWorkspaceAppAccessRules({
    page: 1,
    limit: 20,
  })

  const appAccessRules = appAccessRulesResponse?.items || []

  return (
    <AccessRuleSection
      title="App Access Rules"
      rules={appAccessRules}
      isLoadingRules={isLoading}
      createButtonLabel="Create App permission set"
      onCreate={onCreate}
      onEditRule={onEditRule}
      onAddRole={onAddRole}
      className={className}
    />
  )
}

export default AppAccessRuleSection
