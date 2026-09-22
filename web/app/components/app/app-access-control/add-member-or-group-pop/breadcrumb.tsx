import type { AccessControlGroup } from '@/models/access-control'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

type SelectedGroupsBreadcrumbProps = {
  groups: AccessControlGroup[]
  onChange: (groups: AccessControlGroup[]) => void
}

export function SelectedGroupsBreadcrumb({ groups, onChange }: SelectedGroupsBreadcrumbProps) {
  const { t } = useTranslation()

  const handleBreadcrumbClick = (index: number) => {
    onChange(groups.slice(0, index + 1))
  }
  const handleReset = () => {
    onChange([])
  }
  const hasBreadcrumb = groups.length > 0

  return (
    <Breadcrumb
      aria-label={t(($) => $['accessControlDialog.operateGroupAndMember.allMembers'], {
        ns: 'app',
      })}
      className="flex min-h-7 items-center px-2 py-0.5"
    >
      <BreadcrumbList className="flex-1 gap-0.5 text-xs/4">
        <BreadcrumbItem className="shrink-0">
          {hasBreadcrumb ? (
            <button
              type="button"
              className="min-w-0 cursor-pointer text-left wrap-anywhere text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={handleReset}
            >
              {t(($) => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}
            </button>
          ) : (
            <BreadcrumbPage
              aria-current="location"
              className="wrap-anywhere whitespace-normal text-text-tertiary"
            >
              {t(($) => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {groups.map((group, index) => {
          const isLastGroup = index === groups.length - 1

          return (
            <Fragment key={group.id}>
              <BreadcrumbSeparator className="text-text-tertiary" />
              <BreadcrumbItem>
                {isLastGroup ? (
                  <BreadcrumbPage
                    aria-current="location"
                    className="wrap-anywhere whitespace-normal text-text-tertiary"
                  >
                    {group.name}
                  </BreadcrumbPage>
                ) : (
                  <button
                    type="button"
                    className="min-w-0 cursor-pointer text-left wrap-anywhere text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={() => handleBreadcrumbClick(index)}
                  >
                    {group.name}
                  </button>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
