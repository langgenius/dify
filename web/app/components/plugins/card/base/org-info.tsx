import cn from '@/utils/classnames'

const OrgInfo = ({
  className,
  orgName,
  packageName,
}: {
  className?: string
  orgName: string
  packageName: string
}) => {
  return <div className={cn('flex items-center h-4 space-x-0.5', className)}>
    <span className="shrink-0 text-text-tertiary system-xs-regular">{orgName}</span>
    <span className='shrink-0 text-text-quaternary system-xs-regular'>/</span>
    <span className="shrink-0 w-0 grow truncate text-text-tertiary system-xs-regular">{packageName}</span>
  </div>
}

export default OrgInfo
