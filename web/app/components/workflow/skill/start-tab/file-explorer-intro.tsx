'use client'

import { memo } from 'react'
import { Trans } from 'react-i18next'

const FileExplorerIntro = () => {
  return (
    <section className="px-6 pb-4 pt-4">
      <p className="flex h-8 items-center rounded-md border border-text-accent-secondary bg-components-badge-bg-dimm px-2 text-text-accent-secondary system-xs-medium">
        <Trans
          i18nKey="skill.startTab.fileExplorerIntro"
          ns="workflow"
          components={{
            mention: (
              <span className="mx-0.5 inline-flex h-4 w-3.5 items-center justify-center rounded-[4px] bg-components-button-secondary-accent-text-disabled text-components-button-secondary-accent-text system-kbd">
                @
              </span>
            ),
          }}
        />
      </p>
    </section>
  )
}

export default memo(FileExplorerIntro)
