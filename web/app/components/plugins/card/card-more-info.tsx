import * as React from 'react'
import DownloadCount from './base/download-count'

type Props = {
  downloadCount?: number
  tags: string[]
}

const CardMoreInfoComponent = ({
  downloadCount,
  tags,
}: Props) => {
  return (
    <div className="flex h-5 items-center">
      {downloadCount !== undefined && <DownloadCount downloadCount={downloadCount} />}
      {downloadCount !== undefined && tags && tags.length > 0 && <div className="system-xs-regular mx-2 text-text-quaternary">·</div>}
      {tags && tags.length > 0 && (
        <>
          <div className="flex h-4 flex-wrap space-x-2 overflow-hidden">
            {tags.map(tag => (
              <div
                key={tag}
                className="system-xs-regular flex max-w-[120px] space-x-1 overflow-hidden"
                title={`# ${tag}`}
              >
                <span className="text-text-quaternary">#</span>
                <span className="truncate text-text-tertiary">{tag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Memoize to prevent unnecessary re-renders when tags array hasn't changed
const CardMoreInfo = React.memo(CardMoreInfoComponent)

export default CardMoreInfo
