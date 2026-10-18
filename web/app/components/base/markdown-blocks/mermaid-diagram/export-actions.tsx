import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadBlob } from '@/utils/download'
import { diagramPng } from './export-diagram'

type ExportActionsProps = {
  exportSvg: () => string | null
  disabled: boolean
}

export function ExportActions({ exportSvg, disabled }: ExportActionsProps) {
  const { t } = useTranslation(['common'])
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const copying = copyState === 'pending'
  const status =
    copyState === 'success'
      ? t(($) => $['operation.imageCopied'])
      : copyState === 'error'
        ? t(($) => $['operation.imageCopyFailed'])
        : ''

  const copy = async () => {
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

  const download = () => {
    const svg = exportSvg()
    if (!svg) return
    downloadBlob({
      data: new Blob([svg], { type: 'image/svg+xml' }),
      fileName: 'mermaid.svg',
    })
  }

  const open = () => {
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

  return (
    <>
      <span role="status" className="sr-only">
        {status}
      </span>
      <IconButton
        size="lg"
        aria-label={
          copyState === 'success'
            ? t(($) => $['operation.imageCopied'])
            : t(($) => $['operation.copyImage'])
        }
        disabled={disabled || copying}
        focusableWhenDisabled={copying}
        onClick={copy}
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
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.download'])}
        disabled={disabled}
        onClick={download}
      >
        <span aria-hidden className="i-ri-download-cloud-2-line size-4" />
      </IconButton>
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.openInNewTab'])}
        disabled={disabled}
        onClick={open}
      >
        <span aria-hidden className="i-ri-external-link-line size-4" />
      </IconButton>
    </>
  )
}
