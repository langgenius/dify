import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { difyBuilderSessionViewAtom } from './session/state'
import { buildTraceExport, serializeTraceExport } from './session/trace-export'
import { difyBuilderRuntimeAtom } from './store'

const DebugLogExport = () => {
  const { t } = useTranslation()
  const runtime = useAtomValue(difyBuilderRuntimeAtom)
  const view = useAtomValue(difyBuilderSessionViewAtom)

  const handleExport = () => {
    if (!runtime) return
    const data = buildTraceExport(runtime.session.getTrace(), view)
    const blob = new Blob([serializeTraceExport(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    anchor.href = url
    anchor.download = `builder-trace-${data.meta.session_id || 'nosession'}-${stamp}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            size="md"
            disabled={!runtime}
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-44">
        <DropdownMenuItem onClick={handleExport}>
          <span aria-hidden className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary" />
          <div className="ml-2 system-md-regular text-text-secondary">
            {t(($) => $['difyBuilder.exportDebugLog'], { ns: 'workflow' })}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default DebugLogExport
