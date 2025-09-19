import type { FC } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { useNodesReadOnly } from '../hooks'
import TipPopup from './tip-popup'
import { RiExportLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { getNodesBounds, useReactFlow } from 'reactflow'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { useStore } from '@/app/components/workflow/store'

const ExportImage: FC = () => {
  const { t } = useTranslation()
  const { getNodesReadOnly } = useNodesReadOnly()
  const reactFlow = useReactFlow()

  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewTitle, setPreviewTitle] = useState('')
  const knowledgeName = useStore(s => s.knowledgeName)
  const appName = useStore(s => s.appName)

  const handleExportImage = useCallback(async (type: 'png' | 'jpeg' | 'svg', currentWorkflow = false) => {
    if (!appName && !knowledgeName)
      return

    if (getNodesReadOnly())
      return

    setOpen(false)
    const flowElement = document.querySelector('.react-flow__viewport') as HTMLElement
    if (!flowElement) return

    try {
      let filename = appName || knowledgeName
      const filter = (node: HTMLElement) => {
        if (node instanceof HTMLImageElement)
          return node.complete && node.naturalHeight !== 0

        return true
      }

      let dataUrl

      if (currentWorkflow) {
        // Get all nodes and their bounds
        const nodes = reactFlow.getNodes()
        const nodesBounds = getNodesBounds(nodes)

        // Save current viewport
        const currentViewport = reactFlow.getViewport()

        // Calculate the required zoom to fit all nodes
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const zoom = Math.min(
          viewportWidth / (nodesBounds.width + 100),
          viewportHeight / (nodesBounds.height + 100),
          1,
        )

        // Calculate center position
        const centerX = nodesBounds.x + nodesBounds.width / 2
        const centerY = nodesBounds.y + nodesBounds.height / 2

        // Set viewport to show all nodes
        reactFlow.setViewport({
          x: viewportWidth / 2 - centerX * zoom,
          y: viewportHeight / 2 - centerY * zoom,
          zoom,
        })

        // Wait for the transition to complete
        await new Promise(resolve => setTimeout(resolve, 300))

        // Calculate actual content size with padding
        const padding = 50 // More padding for better visualization
        const contentWidth = nodesBounds.width + padding * 2
        const contentHeight = nodesBounds.height + padding * 2

        // Export with higher quality for whole workflow
        const exportOptions = {
          filter,
          backgroundColor: '#1a1a1a', // Dark background to match previous style
          pixelRatio: 2, // Higher resolution for better zoom
          width: contentWidth,
          height: contentHeight,
          style: {
            width: `${contentWidth}px`,
            height: `${contentHeight}px`,
            transform: `translate(${padding - nodesBounds.x}px, ${padding - nodesBounds.y}px)`,
            transformOrigin: 'top left',
          },
        }

        switch (type) {
          case 'png':
            dataUrl = await toPng(flowElement, exportOptions)
            break
          case 'jpeg':
            dataUrl = await toJpeg(flowElement, exportOptions)
            break
          case 'svg':
            dataUrl = await toSvg(flowElement, { filter })
            break
          default:
            dataUrl = await toPng(flowElement, exportOptions)
        }

        filename += '-whole-workflow'

        // Restore original viewport after a delay
        setTimeout(() => {
          reactFlow.setViewport(currentViewport)
        }, 500)
      }
      else {
        // Current viewport export (existing functionality)
        switch (type) {
          case 'png':
            dataUrl = await toPng(flowElement, { filter })
            break
          case 'jpeg':
            dataUrl = await toJpeg(flowElement, { filter })
            break
          case 'svg':
            dataUrl = await toSvg(flowElement, { filter })
            break
          default:
            dataUrl = await toPng(flowElement, { filter })
        }
      }

      if (currentWorkflow) {
        // For whole workflow, show preview first
        setPreviewUrl(dataUrl)
        setPreviewTitle(`${filename}.${type}`)

        // Also auto-download
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `${filename}.${type}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      else {
        // For current view, just download
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `${filename}.${type}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    }
    catch (error) {
      console.error('Export image failed:', error)
    }
  }, [getNodesReadOnly, appName, reactFlow, knowledgeName])

  const handleTrigger = useCallback(() => {
    if (getNodesReadOnly())
      return

    setOpen(v => !v)
  }, [getNodesReadOnly])

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="top-start"
        offset={{
          mainAxis: 4,
          crossAxis: -8,
        }}
      >
        <PortalToFollowElemTrigger>
          <TipPopup title={t('workflow.common.exportImage')}>
            <div
              className={cn(
                'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
                `${getNodesReadOnly() && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
              )}
              onClick={handleTrigger}
            >
              <RiExportLine className='h-4 w-4' />
            </div>
          </TipPopup>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-10'>
          <div className='min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur text-text-secondary shadow-lg'>
            <div className='p-1'>
              <div className='px-2 py-1 text-xs font-medium text-text-tertiary'>
                {t('workflow.common.currentView')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('png')}
              >
                {t('workflow.common.exportPNG')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('jpeg')}
              >
                {t('workflow.common.exportJPEG')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('svg')}
              >
                {t('workflow.common.exportSVG')}
              </div>

              <div className='border-border-divider mx-2 my-1 border-t' />

              <div className='px-2 py-1 text-xs font-medium text-text-tertiary'>
                {t('workflow.common.currentWorkflow')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('png', true)}
              >
                {t('workflow.common.exportPNG')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('jpeg', true)}
              >
                {t('workflow.common.exportJPEG')}
              </div>
              <div
                className='system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                onClick={() => handleExportImage('svg', true)}
              >
                {t('workflow.common.exportSVG')}
              </div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>

      {previewUrl && (
        <ImagePreview
          url={previewUrl}
          title={previewTitle}
          onCancel={() => setPreviewUrl('')}
        />
      )}
    </>
  )
}

export default memo(ExportImage)
