import type { ArtifactsInspectView } from './hooks/use-artifacts-inspect-state'
import ArtifactsTree from '@/app/components/workflow/skill/file-tree/artifacts/artifacts-tree'

type Props = Pick<
  ArtifactsInspectView,
  'handleFileSelect' | 'handleTreeDownload' | 'isDownloading' | 'selectedFilePath' | 'treeData'
>

export default function ArtifactsLeftPane({
  treeData,
  handleTreeDownload,
  handleFileSelect,
  selectedFilePath,
  isDownloading,
}: Props) {
  return (
    <div className="py-1">
      <ArtifactsTree
        data={treeData}
        onDownload={handleTreeDownload}
        onSelect={handleFileSelect}
        selectedPath={selectedFilePath}
        isDownloading={isDownloading}
      />
    </div>
  )
}
