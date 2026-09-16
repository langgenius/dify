import { cn } from '@langgenius/dify-ui/cn'

type Props = Readonly<{
  className?: string
  orgName?: string
  packageName: string
  packageNameClassName?: string
}>

const OrgInfo = ({ className, orgName, packageName, packageNameClassName }: Props) => {
  return (
    <div className={cn('flex h-4 min-w-0 items-center gap-0.5', className)}>
      {orgName && (
        <>
          <span
            className="min-w-0 shrink truncate system-xs-regular text-text-tertiary"
            title={orgName}
          >
            {orgName}
          </span>
          <span className="shrink-0 system-xs-regular text-text-quaternary">/</span>
        </>
      )}
      <span
        className={cn(
          'min-w-0 shrink truncate system-xs-regular text-text-tertiary',
          packageNameClassName,
        )}
        title={packageName}
      >
        {packageName}
      </span>
    </div>
  )
}

export default OrgInfo
