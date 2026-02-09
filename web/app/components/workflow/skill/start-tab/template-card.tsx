'use client'

import type { SkillTemplateSummary } from './templates/types'
import { RiAddLine, RiCheckLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'

type TemplateCardProps = {
  template: SkillTemplateSummary
  added?: boolean
  disabled?: boolean
  loading?: boolean
  onUse: (template: SkillTemplateSummary) => void
}

const TemplateCard = ({ template, added, disabled, loading, onUse }: TemplateCardProps) => {
  const { t } = useTranslation('workflow')

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg transition-colors hover:bg-components-panel-on-panel-item-bg-hover">
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <AppIcon
          size="large"
          icon="📙"
          className="!bg-components-icon-bg-violet-soft"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <span className="truncate text-text-secondary system-md-semibold">
            {template.name}
          </span>
          <span className="text-text-tertiary system-xs-regular">
            {t('skill.startTab.filesIncluded', { count: template.fileCount })}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-1">
        <p className="line-clamp-2 min-h-[32px] w-full text-text-tertiary system-xs-regular">
          {template.description}
        </p>
      </div>
      <div className="relative px-4 pb-4">
        <div className="h-[18px]" />
        <div className="pointer-events-none absolute inset-0 flex items-end px-4 pb-4 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          {added
            ? (
                <Button
                  variant="secondary"
                  size="medium"
                  className="w-full"
                  disabled
                >
                  <RiCheckLine className="mr-0.5 h-4 w-4" />
                  {t('skill.startTab.skillAdded')}
                </Button>
              )
            : (
                <Button
                  variant="primary"
                  size="medium"
                  className="w-full"
                  disabled={disabled}
                  loading={loading}
                  onClick={() => onUse(template)}
                >
                  <RiAddLine className="mr-0.5 h-4 w-4" />
                  {t('skill.startTab.useThisSkill')}
                </Button>
              )}
        </div>
      </div>
    </div>
  )
}

export default memo(TemplateCard)
