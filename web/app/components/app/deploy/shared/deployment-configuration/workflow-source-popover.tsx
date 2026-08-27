'use client'

import type {
  WorkflowPath,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AppIconType } from '@/types/app'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'
import { workflowPathKey } from './utils/workflow-path'

function workflowReferenceIconType(reference: WorkflowReference): AppIconType | undefined {
  if (reference.icon_type === 'emoji') return 'emoji'
  if (reference.icon_type === 'image' || reference.icon_type === 'link') return 'image'

  return undefined
}

function workflowReferenceImageUrl(reference: WorkflowReference) {
  if (reference.icon_type !== 'image' && reference.icon_type !== 'link') return undefined

  return reference.icon_url ?? reference.icon
}

export function WorkflowReferenceIcon({ reference }: { reference: WorkflowReference }) {
  return (
    <span aria-hidden className="shrink-0">
      <AppIcon
        size="xs"
        iconType={workflowReferenceIconType(reference)}
        icon={reference.icon}
        background={reference.icon_background}
        imageUrl={workflowReferenceImageUrl(reference)}
        className="size-5 rounded-md text-sm"
      />
    </span>
  )
}

function WorkflowPathLink({ path }: { path: WorkflowPath }) {
  const leafWorkflow = path.workflows.at(-1)
  if (!leafWorkflow) return null

  return (
    <Link
      href={`/app/${leafWorkflow.app_id}/workflow`}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-7 min-w-0 items-center gap-1 rounded-md py-1 pr-2 pl-1 system-sm-regular text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {path.workflows.map((workflow, index) => (
          <Fragment key={`${workflow.app_id}:${workflow.workflow_id}`}>
            {index > 0 && (
              <span
                aria-hidden
                className="i-ri-arrow-right-s-line size-3.5 shrink-0 text-text-tertiary"
              />
            )}
            <span className="flex min-w-0 shrink items-center gap-2">
              <WorkflowReferenceIcon reference={workflow} />
              <span className="min-w-0 truncate">{workflow.name}</span>
            </span>
          </Fragment>
        ))}
      </span>
      <span
        aria-hidden
        className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary group-hover:text-text-secondary"
      />
    </Link>
  )
}

function WorkflowSourceContent({ paths, title }: { paths: WorkflowPath[]; title: string }) {
  return (
    <PopoverContent
      placement="top-end"
      sideOffset={4}
      className="w-max max-w-[min(30rem,calc(100vw-32px))] bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]"
    >
      <PopoverTitle className="sr-only">{title}</PopoverTitle>
      <ul className="flex flex-col gap-px">
        {paths.map((path) => (
          <li key={workflowPathKey(path)}>
            <WorkflowPathLink path={path} />
          </li>
        ))}
      </ul>
    </PopoverContent>
  )
}

export function WorkflowDependencyPreview({
  paths,
  subjectName,
}: {
  paths: WorkflowPath[]
  subjectName: string
}) {
  const { t } = useTranslation('deployments')
  const validPaths = [
    ...new Map(
      paths
        .filter((path) => path.workflows.length > 0)
        .map((path) => [workflowPathKey(path), path] as const),
    ).values(),
  ]
  const firstLeafWorkflow = validPaths[0]?.workflows.at(-1)

  if (!firstLeafWorkflow) return null

  const sourceLabel =
    validPaths.length === 1
      ? firstLeafWorkflow.name
      : t(($) => $['studio.precheck.nodeCount_other'], { count: validPaths.length })

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            className="group/source flex min-w-0 shrink-0 cursor-help items-center gap-1 rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
          >
            <span className="sr-only">{subjectName}: </span>
            <span className="shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['studio.precheck.from'])}
            </span>
            <span className="max-w-30 truncate border-b border-dotted border-text-quaternary system-xs-regular text-text-tertiary group-hover/source:text-text-secondary group-data-popup-open/source:text-text-secondary">
              {sourceLabel}
            </span>
          </button>
        }
      />
      <WorkflowSourceContent paths={validPaths} title={subjectName} />
    </Popover>
  )
}

export function SubworkflowSourceTitle({ source }: { source: WorkflowReference }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            className="group/source max-w-full min-w-0 cursor-help truncate rounded-sm border-b border-dotted border-text-quaternary text-start system-sm-semibold text-text-primary outline-hidden hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-state-accent-solid data-popup-open:text-text-secondary"
          >
            {source.name}
          </button>
        }
      />
      <WorkflowSourceContent paths={[{ workflows: [source] }]} title={source.name} />
    </Popover>
  )
}
