import { cn } from '@langgenius/dify-ui/cn'
import { DialogBackdrop, DialogClose, DialogPopup } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadBlob } from '@/utils/download'
import styles from './diagram.module.css'
import { diagramPng } from './export-diagram'
import { useDiagram } from './use-diagram'

export function DiagramPreview({ source }: { source: string }) {
  // A preview session keeps its drawing while the answer continues streaming.
  const [snapshot] = useState(source)
  const diagram = useDiagram({ source: snapshot, mode: 'preview' })

  return (
    <>
      {/* Full-screen previews need their own visual scrim inside transparent Drawers too. */}
      <DialogBackdrop forceRender className="bg-background-overlay-fullscreen" />
      <DialogPopup
        aria-label="Mermaid"
        initialFocus={diagram.stageRef}
        className={cn(
          styles.diagram,
          'fixed inset-0 flex flex-col transition-opacity data-closed:pointer-events-none data-ending-style:scale-100 data-starting-style:scale-100',
        )}
      >
        <div
          ref={diagram.stageRef}
          role="group"
          aria-label="Mermaid"
          tabIndex={-1}
          className="flex min-h-0 flex-1 items-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid"
        >
          <div ref={diagram.canvasRef} className={styles.canvas} />
        </div>
        <DiagramPreviewActions
          ready={diagram.ready}
          zoomBy={diagram.zoomBy}
          reset={diagram.reset}
          exportSvg={diagram.exportSvg}
        />
        {diagram.error && (
          <p role="status" className="mt-2 system-xs-regular text-text-destructive">
            {diagram.error}
          </p>
        )}
      </DialogPopup>
    </>
  )
}

type DiagramPreviewActionsProps = Pick<
  ReturnType<typeof useDiagram>,
  'ready' | 'zoomBy' | 'reset' | 'exportSvg'
>

function DiagramPreviewActions({ ready, zoomBy, reset, exportSvg }: DiagramPreviewActionsProps) {
  const { t } = useTranslation(['common'])
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  useEffect(() => {
    if (copyState !== 'success') return
    const timeout = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timeout)
  }, [copyState])
  const copying = copyState === 'pending'
  const status =
    copyState === 'success'
      ? t(($) => $['operation.imageCopied'])
      : copyState === 'error'
        ? t(($) => $['operation.imageCopyFailed'])
        : ''

  const copyImage = async () => {
    const svg = exportSvg()
    if (!svg || copying) return
    setCopyState('pending')
    try {
      const png = diagramPng(svg)
      // Consume encoding failures even when the browser rejects clipboard access first.
      void png.catch(() => {})
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setCopyState('success')
    } catch {
      setCopyState('error')
    }
  }

  const downloadImage = () => {
    const svg = exportSvg()
    if (!svg) return
    downloadBlob({
      data: new Blob([svg], { type: 'image/svg+xml' }),
      fileName: 'mermaid.svg',
    })
  }

  const openImage = () => {
    const svg = exportSvg()
    if (!svg) return
    const target = window.open()
    if (!target) return
    target.opener = null
    target.document.title = 'Mermaid'
    const image = target.document.createElement('img')
    image.alt = 'Mermaid'
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    target.document.body.append(image)
  }

  const copyLabel =
    copyState === 'success'
      ? t(($) => $['operation.imageCopied'])
      : t(($) => $['operation.copyImage'])
  const downloadLabel = t(($) => $['operation.download'])
  const openLabel = t(($) => $['operation.openInNewTab'])

  const zoomInLabel = t(($) => $['operation.zoomIn'])
  const zoomOutLabel = t(($) => $['operation.zoomOut'])
  const resetLabel = t(($) => $['operation.reset'])

  const closeLabel = t(($) => $['operation.close'])

  return (
    <Tooltip<string>>
      {({ payload }) => (
        <>
          <div className="absolute top-4 right-4 sm:top-8 sm:right-8">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-2 -right-2 -bottom-6 -left-8 bg-[radial-gradient(ellipse_at_top_right,var(--color-background-overlay-fullscreen)_45%,transparent_75%)]"
            />
            <div className="relative flex items-center gap-1">
              <TooltipTrigger
                payload={zoomInLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={zoomInLabel}
                    disabled={!ready}
                    onClick={() => zoomBy(1.25)}
                  >
                    <span aria-hidden className="i-ri-add-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={zoomOutLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={zoomOutLabel}
                    disabled={!ready}
                    onClick={() => zoomBy(0.8)}
                  >
                    <span aria-hidden className="i-ri-subtract-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={resetLabel}
                render={
                  <IconButton size="lg" aria-label={resetLabel} disabled={!ready} onClick={reset}>
                    <span aria-hidden className="i-ri-restart-line size-4" />
                  </IconButton>
                }
              />
              <span
                role="status"
                className={
                  copyState === 'error'
                    ? 'absolute top-full right-0 rounded-md bg-components-panel-bg px-2 py-1 system-xs-regular text-text-destructive'
                    : 'sr-only'
                }
              >
                {status}
              </span>
              <TooltipTrigger
                payload={copyLabel}
                closeOnClick={false}
                render={
                  <IconButton
                    size="lg"
                    aria-label={copyLabel}
                    disabled={!ready || copying}
                    focusableWhenDisabled={copying}
                    onClick={copyImage}
                  >
                    <span
                      aria-hidden
                      className={
                        copying
                          ? 'i-ri-loader-4-line size-4 animate-spin motion-reduce:animate-none'
                          : copyState === 'success'
                            ? 'i-ri-check-line size-4'
                            : 'i-ri-file-copy-line size-4'
                      }
                    />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={downloadLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={downloadLabel}
                    disabled={!ready}
                    onClick={downloadImage}
                  >
                    <span aria-hidden className="i-ri-download-cloud-2-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={openLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={openLabel}
                    disabled={!ready}
                    onClick={openImage}
                  >
                    <span aria-hidden className="i-ri-external-link-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={closeLabel}
                render={
                  <DialogClose
                    render={
                      <IconButton size="lg" aria-label={closeLabel}>
                        <span aria-hidden className="i-ri-close-line size-4" />
                      </IconButton>
                    }
                  />
                }
              />
            </div>
          </div>
          <TooltipContent>{payload}</TooltipContent>
        </>
      )}
    </Tooltip>
  )
}
