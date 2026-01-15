import type { FC } from 'react'
import * as React from 'react'

const SkillDocEditor: FC = () => {
  return (
    <div
      className="h-full w-full overflow-y-auto bg-components-panel-bg"
      data-component="skill-doc-editor"
    />
  )
}

export default React.memo(SkillDocEditor)
