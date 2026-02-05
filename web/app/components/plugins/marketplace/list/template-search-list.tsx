'use client'

import type { Template } from '../types'
import Empty from '../empty'
import TemplateCard from './template-card'

type TemplateSearchListProps = {
  templates: Template[]
}

const TemplateSearchList = ({ templates }: TemplateSearchListProps) => {
  if (templates.length === 0) {
    return <Empty />
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {templates.map(template => (
        <div key={template.template_id}>
          <TemplateCard template={template} />
        </div>
      ))}
    </div>
  )
}

export default TemplateSearchList
