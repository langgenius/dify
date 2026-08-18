import {
  DropdownMenuArrow,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type OperationsProps = {
  showEdit?: boolean
  showDelete: boolean
  showExportPipeline: boolean
  showAccessConfig?: boolean
  showUpgrade?: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
  openAccessConfig: () => void
  onUpgrade?: () => void
  onClose?: () => void
}

const Operations = ({
  showEdit = true,
  showDelete,
  showExportPipeline,
  showAccessConfig = false,
  showUpgrade = false,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  openAccessConfig,
  onUpgrade,
  onClose,
}: OperationsProps) => {
  const { t } = useTranslation()

  const handleRename = () => {
    onClose?.()
    openRenameModal()
  }

  const handleExport = () => {
    onClose?.()
    handleExportPipeline()
  }

  const handleDelete = () => {
    onClose?.()
    detectIsUsedByApp()
  }

  const handleAccessConfig = () => {
    onClose?.()
    openAccessConfig()
  }

  const handleUpgrade = () => {
    onClose?.()
    onUpgrade?.()
  }

  return (
    <>
      {showUpgrade && (
        <>
          <div role="presentation" className="flex">
            <DropdownMenuItem
              className="mr-0 min-w-0 flex-1 rounded-r-none text-text-accent"
              onClick={handleUpgrade}
            >
              <span aria-hidden className="mr-1 i-ri-arrow-up-circle-line size-4" />
              <span className="min-w-0 flex-1">
                {t(($) => $['newKnowledge.upgrade.menuLabel'], { ns: 'dataset' })}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                aria-label={t(($) => $['newKnowledge.upgrade.guideTitle'], { ns: 'dataset' })}
                className="ml-0 w-8 shrink-0 rounded-l-none px-2 text-text-quaternary [&>span:last-child]:hidden"
              >
                <span aria-hidden className="i-ri-question-line size-4" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                placement="right-start"
                sideOffset={12}
                popupClassName="w-80 max-w-[calc(100vw-2rem)] overflow-visible rounded-xl border border-divider-subtle bg-components-panel-bg p-0 shadow-md"
              >
                <DropdownMenuArrow />
                <div role="presentation" className="px-4 pt-3.5">
                  <div className="system-md-medium text-text-primary">
                    {t(($) => $['newKnowledge.upgrade.guideTitle'], { ns: 'dataset' })}
                  </div>
                  <p className="mt-2 system-sm-regular text-text-secondary">
                    {t(($) => $['newKnowledge.upgrade.guideDescription'], { ns: 'dataset' })}
                  </p>
                </div>
                <DropdownMenuLinkItem
                  href="https://docs.dify.ai/en/guides/knowledge-base"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 mb-1 justify-end system-xs-medium text-text-accent"
                >
                  {t(($) => $['newKnowledge.learnMore'], { ns: 'dataset' })}
                </DropdownMenuLinkItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>
          <DropdownMenuSeparator />
        </>
      )}
      {showEdit && (
        <DropdownMenuItem onClick={handleRename}>
          <span aria-hidden className="mr-1 i-ri-edit-line size-4 text-text-tertiary" />
          {t(($) => $['operation.edit'], { ns: 'common' })}
        </DropdownMenuItem>
      )}
      {showExportPipeline && (
        <DropdownMenuItem onClick={handleExport}>
          <span aria-hidden className="mr-1 i-ri-file-download-line size-4 text-text-tertiary" />
          {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
        </DropdownMenuItem>
      )}
      {showAccessConfig && (
        <DropdownMenuItem onClick={handleAccessConfig}>
          <span aria-hidden className="mr-1 i-ri-lock-line size-4 text-text-tertiary" />
          {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
        </DropdownMenuItem>
      )}
      {showDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleDelete}>
            <span aria-hidden className="mr-1 i-ri-delete-bin-line size-4" />
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

export default React.memo(Operations)
