import { cn } from '@/utils/classnames'

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
          <span className="shrink-0 text-text-tertiary system-xs-regular">{orgName}</span>
          <span className="shrink-0 text-text-quaternary system-xs-regular">/</span>
        </>
      )}
      <span className={cn('w-0 shrink-0 grow truncate text-text-tertiary system-xs-regular', packageNameClassName)}>
        {packageName}
      </span>
    </div>
  )
}

export default OrgInfo
