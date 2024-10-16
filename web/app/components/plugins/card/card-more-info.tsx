import DownloadCount from './base/download-count'

type Props = {
  downloadCount?: number
  tags: string[]
}

const CardMoreInfo = ({
  downloadCount,
  tags,
}: Props) => {
  return (
    <div className="flex items-center h-5">
      {downloadCount !== undefined && <DownloadCount downloadCount={downloadCount} />}
      {downloadCount !== undefined && tags && tags.length > 0 && <div className="mx-2 text-text-quaternary system-xs-regular">·</div>}
      {tags && tags.length > 0 && (
        <>
          <div className="flex flex-wrap space-x-2 h-4 overflow-hidden">
            {tags.map(tag => (
              <div
                key={tag}
                className="flex space-x-1 system-xs-regular max-w-[120px] overflow-hidden"
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

export default CardMoreInfo
