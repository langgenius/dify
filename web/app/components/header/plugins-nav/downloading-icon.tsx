import { cn } from '@langgenius/dify-ui/cn'

type DownloadingIconProps = {
  active?: boolean
  className?: string
}

const DownloadingIcon = ({
  active = true,
  className,
}: DownloadingIconProps) => {
  return (
    <span className={cn('inline-flex size-4 shrink-0 text-components-button-secondary-text', className)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="install-icon size-4">
        <g id="install-line">
          <path d="M5.33333 1.33333V2.66666H3.33333L3.33267 9.33333H12.666L12.6667 2.66666H10.6667V1.33333H13.3333C13.7015 1.33333 14 1.63181 14 1.99999V14C14 14.3682 13.7015 14.6667 13.3333 14.6667H2.66667C2.29848 14.6667 2 14.3682 2 14V1.99999C2 1.63181 2.29848 1.33333 2.66667 1.33333H5.33333ZM12.666 10.6667H3.33267L3.33333 13.3333H12.6667L12.666 10.6667Z" fill="currentColor" />
          <path d="M11.3333 12.6667V11.3333H10V12.6667H11.3333Z" fill={active ? '#17B26A' : 'currentColor'} />
          <path d="M8.66666 1.33333V4.66666H10.6667L8 7.33333L5.33333 4.66666H7.33333V1.33333H8.66666Z" fill="currentColor" />
        </g>
      </svg>
    </span>
  )
}

export default DownloadingIcon
