import { RiBookOpenLine, RiEqualizer2Line } from '@remixicon/react'
import * as React from 'react'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'

type HeaderProps = {
  onClickConfiguration?: () => void
  docTitle: string
  docLink: string
}

const Header = ({
  onClickConfiguration,
  docTitle,
  docLink,
}: HeaderProps) => {
  return (
    <div className="flex items-center gap-x-2">
      <div className="flex shrink-0 grow items-center gap-x-1">
        <div className="w-20 bg-black">
          {/* placeholder */}
        </div>
        <Divider type="vertical" className="mx-1 h-3.5" />
        <Button
          variant="ghost"
          size="small"
          className="px-1"
        >
          <RiEqualizer2Line
            className="size-4"
            onClick={onClickConfiguration}
          />
        </Button>
      </div>
      <a
        className="system-xs-medium flex items-center gap-x-1 overflow-hidden text-text-accent"
        href={docLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        <RiBookOpenLine className="size-3.5 shrink-0" />
        <span className="grow truncate" title={docTitle}>{docTitle}</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
