import cn from '@/utils/classnames'
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
          <span className='text-text-tertiary system-xs-regular shrink-0'>{orgName}</span>
          <span className='text-text-quaternary system-xs-regular shrink-0'>/</span>
        </>
      )}
      <span className={cn('text-text-tertiary system-xs-regular w-0 shrink-0 grow truncate', packageNameClassName)}>
        {packageName}
      </span>
    </div>
  )
}

export default OrgInfo
