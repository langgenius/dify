'use client'

import * as React from 'react'

const INDENT_SIZE = 20

type TreeGuideLinesProps = {
  level: number
}

const TreeGuideLines: React.FC<TreeGuideLinesProps> = ({ level }) => {
  if (level === 0)
    return null

  return (
    <>
      {Array.from({ length: level }).map((_, i) => (
        <div
          key={`guide-${i}`}
          className="absolute bottom-0 top-0 border-l border-divider-subtle"
          style={{ left: `${(i + 1) * INDENT_SIZE - 10}px` }}
        />
      ))}
    </>
  )
}

export default React.memo(TreeGuideLines)
