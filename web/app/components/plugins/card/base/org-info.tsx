import { cn } from '@langgenius/dify-ui/cn'

type Props = {
  className?: string
  orgName?: string
  packageName?: string
  packageNameClassName?: string
  downloadCount?: number
  linkToOrg?: boolean
}

const OrgInfo = ({
  className,
  orgName,
  packageName,
  packageNameClassName,
  downloadCount,
  linkToOrg = true,
}: Props) => {
  // New format: "by {orgName} · {downloadCount} installs" (for marketplace cards)
  if (downloadCount !== undefined) {
    return (
      <div className={cn('system-xs-regular flex h-4 items-center gap-2 text-text-tertiary', className)}>
        {orgName && (
          <span className="shrink-0">
            <span className="mr-1 text-text-tertiary">by</span>
            {linkToOrg
              ? (
                  <Link
                    href={`/creator/${orgName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-text-secondary hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {orgName}
                  </Link>
                )
              : (
                  <span className="text-text-tertiary">
                    {orgName}
                  </span>
                )}
          </span>
        )}
        <span className="shrink-0">·</span>
        <DownloadCount downloadCount={downloadCount} />
      </div>
    )
  }

  // Legacy format: "{orgName} / {packageName}" (for plugin detail panels)
  return (
    <div className={cn('flex h-4 items-center space-x-0.5', className)}>
      {orgName && (
        <>
          <span className="shrink-0 system-xs-regular text-text-tertiary">{orgName}</span>
          <span className="shrink-0 system-xs-regular text-text-quaternary">/</span>
        </>
      )}
      <span className={cn('w-0 shrink-0 grow truncate system-xs-regular text-text-tertiary', packageNameClassName)}>
        {packageName}
      </span>
    </div>
  )
}

export default OrgInfo
