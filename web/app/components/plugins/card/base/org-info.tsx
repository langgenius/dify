import { cn } from '@langgenius/dify-ui/cn'

type Props = {
  className?: string
  orgName?: string
  packageName: string
  packageNameClassName?: string
}

const OrgInfo = ({
  className,
  orgName,
  packageName,
  packageNameClassName,
}: Props) => {
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
