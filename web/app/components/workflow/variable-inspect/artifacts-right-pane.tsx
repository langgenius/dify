import type { ArtifactsInspectView } from './hooks/use-artifacts-inspect-state'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import ReadOnlyFilePreview from '@/app/components/workflow/skill/viewer/read-only-file-preview'
import { cn } from '@/utils/classnames'
import ArtifactsEmptyState from './artifacts-empty-state'
import useInspectShell from './hooks/use-inspect-shell'

type Props = Pick<
  ArtifactsInspectView,
  'downloadUrlData' | 'handleSelectedFileDownload' | 'isDownloadUrlLoading' | 'pathSegments' | 'selectedFile' | 'selectedFilePath'
>

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function ArtifactsRightPane({
  downloadUrlData,
  handleSelectedFileDownload,
  isDownloadUrlLoading,
  pathSegments,
  selectedFile,
  selectedFilePath,
}: Props) {
  const { t } = useTranslation('workflow')
  const { isNarrow, onClose, openLeftPane } = useInspectShell()
  const file = selectedFilePath ? selectedFile : null

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {isNarrow
            ? (
                <ActionButton className="shrink-0" onClick={openLeftPane} aria-label="Open menu">
                  <span className="i-ri-menu-line h-4 w-4" aria-hidden="true" />
                </ActionButton>
              )
            : null}
          {file
            ? (
                <>
                  <div className="flex w-0 grow items-center gap-1">
                    <div className="flex items-center gap-1 truncate">
                      {pathSegments.map(seg => (
                        <span key={seg.key} className="flex items-center gap-1">
                          {!seg.isFirst ? <span className="text-text-quaternary system-sm-regular">/</span> : null}
                          <span
                            className={cn(
                              'truncate system-sm-semibold',
                              seg.isLast ? 'text-text-secondary' : 'text-text-tertiary',
                            )}
                          >
                            {seg.part}
                          </span>
                        </span>
                      ))}
                    </div>
                    <span className="shrink-0 text-text-tertiary system-xs-medium">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ActionButton
                      onClick={handleSelectedFileDownload}
                      disabled={!downloadUrlData?.download_url}
                      aria-label={`Download ${file.name}`}
                    >
                      <span className="i-custom-vender-line-files-file-download-01 h-4 w-4" aria-hidden="true" />
                    </ActionButton>
                  </div>
                </>
              )
            : null}
        </div>
        <ActionButton className="shrink-0" onClick={onClose} aria-label="Close">
          <span className="i-ri-close-line h-4 w-4" aria-hidden="true" />
        </ActionButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {file
          ? (
              <div className="min-h-0 grow">
                {isDownloadUrlLoading
                  ? <div className="flex h-full items-center justify-center"><Loading type="area" /></div>
                  : downloadUrlData?.download_url
                    ? (
                        <ReadOnlyFilePreview
                          downloadUrl={downloadUrlData.download_url}
                          fileName={file.name}
                          extension={file.extension}
                          fileSize={file.size}
                        />
                      )
                    : (
                        <div className="flex h-full items-center justify-center rounded-xl bg-background-section">
                          <p className="text-text-tertiary system-xs-regular">
                            {t('debug.variableInspect.tabArtifacts.previewNotAvailable')}
                          </p>
                        </div>
                      )}
              </div>
            )
          : (
              <div className="grow p-2">
                <ArtifactsEmptyState description={t('debug.variableInspect.tabArtifacts.selectFile')} />
              </div>
            )}
      </div>
    </>
  )
}
