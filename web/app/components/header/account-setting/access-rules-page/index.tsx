'use client'

import AppAccessRuleSection from './app-access-rule-section'
import DatasetAccessRuleSection from './dataset-access-rule-section'

const AccessRulesPage = () => {
  return (
    <div className="flex flex-col gap-6">
      <AppAccessRuleSection />
      <DatasetAccessRuleSection />
    </div>
  )
}

export default AccessRulesPage
