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
    <div className="flex h-5 items-center">
      {downloadCount !== undefined && <DownloadCount downloadCount={downloadCount} />}
      {downloadCount !== undefined && tags && tags.length > 0 && <div className="text-text-quaternary system-xs-regular mx-2">·</div>}
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
                <span className="text-text-tertiary truncate">{tag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default CardMoreInfo
