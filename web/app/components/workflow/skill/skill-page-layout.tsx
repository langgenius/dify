import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type SkillPageLayoutProps = PropsWithChildren

const SkillPageLayout: FC<SkillPageLayoutProps> = ({ children }) => {
  return (
    <div className="flex h-full gap-3">
      {children}
    </div>
  )
}

export default React.memo(SkillPageLayout)
