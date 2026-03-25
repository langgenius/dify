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
          <span className="system-xs-regular shrink-0 text-text-tertiary">{orgName}</span>
          <span className="system-xs-regular shrink-0 text-text-quaternary">/</span>
        </>
      )}
      <span className={cn('system-xs-regular w-0 shrink-0 grow truncate text-text-tertiary', packageNameClassName)}>
        {packageName}
      </span>
    </div>
  )
}

export default OrgInfo
