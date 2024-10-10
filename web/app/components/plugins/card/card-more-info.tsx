import DownloadCount from './base/download-count'

type Props = {
  downloadCount: number
  tags: string[]
}

const CardMoreInfo = ({
  downloadCount,
  tags,
}: Props) => {
  return (
    <div className="flex items-center h-5">
      <DownloadCount downloadCount={downloadCount} />
      {tags && tags.length > 0 && (
        <>
          <div className="mx-2 text-text-quaternary system-xs-regular">·</div>
          <div className="flex space-x-2">
            {tags.map(tag => (
              <div key={tag} className="flex space-x-1 system-xs-regular">
                <span className="text-text-quaternary">#</span>
                <span className="text-text-tertiary">{tag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default CardMoreInfo
