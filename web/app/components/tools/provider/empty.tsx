'use client'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowRightLine, RiArrowRightUpLine } from '@remixicon/react'
import { useTranslation } from '#i18n'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useDocLink } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import Link from '@/next/link'
import { NoToolPlaceholder } from '../../base/icons/src/vender/other'
import { ToolTypeEnum } from '../../workflow/block-selector/types'

type Props = Readonly<{
  type?: ToolTypeEnum
  isAgent?: boolean
}>

const workflowToolStepKeys = [
  'workflowToolEmpty.step1',
  'workflowToolEmpty.step2',
  'workflowToolEmpty.step3',
] as const

const getLink = (type?: ToolTypeEnum) => {
  switch (type) {
    case ToolTypeEnum.Custom:
      return buildIntegrationPath('custom-tool')
    case ToolTypeEnum.MCP:
      return buildIntegrationPath('mcp')
    default:
      return buildIntegrationPath('custom-tool')
  }
}
const Empty = ({
  type,
  isAgent,
}: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { theme } = useTheme()

  const hasLink = type && [ToolTypeEnum.Custom, ToolTypeEnum.MCP].includes(type)
  const renderType = isAgent ? 'agent' as const : type
  const hasTitle = renderType && t(`addToolModal.${renderType}.title`, { ns: 'tools' }) !== `addToolModal.${renderType}.title`
  const tipClassName = cn(
    'flex items-center text-[13px] leading-[18px] text-text-tertiary',
    hasLink && 'cursor-pointer hover:text-text-accent',
  )
  const tipContent = renderType && (
    <>
      {t(`addToolModal.${renderType}.tip`, { ns: 'tools' })}
      {' '}
      {hasLink && <RiArrowRightUpLine className="ml-0.5 size-3" />}
    </>
  )

  if (!isAgent && type === ToolTypeEnum.Workflow) {
    return (
      <div className="flex w-full max-w-[1060px] flex-col items-center gap-8 text-center">
        <div className="flex w-full max-w-[739px] flex-col items-center gap-1">
          <div className="text-[24px] font-semibold text-text-primary">
            {t('workflowToolEmpty.title', { ns: 'tools' })}
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {t('workflowToolEmpty.description', { ns: 'tools' })}
          </div>
        </div>
        <div className="flex w-full flex-col items-center gap-4">
          <div className="grid w-full grid-cols-1 justify-center gap-3 lg:grid-cols-[repeat(3,320px)]">
            {workflowToolStepKeys.map((stepKey, index) => (
              <div
                key={stepKey}
                className="grid min-h-[140px] grid-rows-[24px_1fr] gap-3 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-8 py-6 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-state-base-hover text-[15px] font-semibold text-text-secondary">
                    {index + 1}
                  </div>
                  <div className="h-px flex-1 bg-divider-subtle" />
                </div>
                <div className="text-left system-md-semibold text-text-secondary">
                  {t(stepKey, { ns: 'tools' })}
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/apps"
            className="flex h-7 items-center gap-1.5 py-1 system-sm-semibold text-text-accent hover:text-text-accent-secondary"
          >
            {t('workflowToolEmpty.goToStudio', { ns: 'tools' })}
            <span className="flex size-5 items-center justify-center rounded-full bg-text-accent text-text-primary-on-surface">
              <RiArrowRightLine className="size-4" />
            </span>
          </Link>
        </div>
        <Link
          href={`${docLink('/use-dify/workspace/tools' as DocPathWithoutLang)}#workflow-tool`}
          target="_blank"
          rel="noreferrer"
          className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-tertiary hover:text-text-accent"
        >
          {t('workflowToolEmpty.learnMore', { ns: 'tools' })}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <NoToolPlaceholder className={theme === 'dark' ? 'invert' : ''} />
      <div className="mt-2 mb-1 text-[13px] leading-[18px] font-medium text-text-primary">
        {(hasTitle && renderType) ? t(`addToolModal.${renderType}.title`, { ns: 'tools' }) : 'No tools available'}
      </div>
      {!!(!isAgent && hasTitle && renderType && hasLink) && (
        <Link
          href={getLink(type)}
          target="_blank"
          rel="noreferrer"
          className={tipClassName}
        >
          {tipContent}
        </Link>
      )}
      {!!(!isAgent && hasTitle && renderType && !hasLink) && (
        <div className={tipClassName}>
          {tipContent}
        </div>
      )}
    </div>
  )
}

export default Empty
