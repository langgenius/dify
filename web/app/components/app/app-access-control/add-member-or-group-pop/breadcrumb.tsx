import type { AccessControlGroup } from '@/models/access-control'
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
    <div className="flex h-7 items-center gap-x-0.5 px-2 py-0.5">
      {hasBreadcrumb ? (
        <button
          type="button"
          className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={handleReset}
        >
          {t(($) => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}
        </button>
      ) : (
        <span className="system-xs-regular text-text-tertiary">
          {t(($) => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}
        </span>
      )}
      {groups.map((group, index) => {
        const isLastGroup = index === groups.length - 1

        return (
          <div
            key={group.id}
            className="flex items-center gap-x-0.5 system-xs-regular text-text-tertiary"
          >
            <span>/</span>
            {isLastGroup ? (
              <span>{group.name}</span>
            ) : (
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={() => handleBreadcrumbClick(index)}
              >
                {group.name}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
