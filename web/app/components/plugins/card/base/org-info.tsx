import cn from '@/utils/classnames'
type Props = {
  className?: string
  orgName: string
  packageName: string
  packageNameClassName?: string
  isLoading?: boolean
}

const OrgInfo = ({
  className,
  orgName,
  packageName,
  packageNameClassName,
  isLoading = false,
}: Props) => {
  const LoadingPlaceholder = ({ width }: { width: string }) => (
    <div className={`h-2 w-${width} rounded-sm opacity-20 bg-text-quaternary`} />
  )
  return (
    <div className={cn('flex items-center h-4 space-x-0.5', className)}>
      {isLoading
        ? (
          <LoadingPlaceholder width="[41px]" />
        )
        : (
          <span className='shrink-0 text-text-tertiary system-xs-regular'>{orgName}</span>
        )}
      <span className='shrink-0 text-text-quaternary system-xs-regular'>
        {isLoading ? '·' : '/'}
      </span>
      {isLoading
        ? (
          <LoadingPlaceholder width="[180px]" />
        )
        : (
          <span className={cn('shrink-0 w-0 grow truncate text-text-tertiary system-xs-regular', packageNameClassName)}>
            {packageName}
          </span>
        )}
    </div>
  )
}

export default OrgInfo
