'use client'

import { ResourceAccessRuleSection } from './resource-access-rule-section'

const AccessRulesPage = () => {
  return (
    <div className="flex flex-col gap-4">
      <ResourceAccessRuleSection resourceType="app" />
      <ResourceAccessRuleSection resourceType="dataset" />
      <ResourceAccessRuleSection resourceType="agent" />
    </div>
  )
}

export default AccessRulesPage
