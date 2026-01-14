import type { FC } from 'react'
import * as React from 'react'

const SkillDocEditor: FC = () => {
  return (
    <div
      className="h-full w-full rounded-md bg-white"
      data-component="skill-doc-editor"
    />
  )
}

export default React.memo(SkillDocEditor)
