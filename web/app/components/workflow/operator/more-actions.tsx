import type { FC } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiExportLine, RiMoreFill } from '@remixicon/react'
import { toJpeg, toPng, toSvg } from 'html-to-image'
import { useNodesReadOnly } from '../hooks'
import TipPopup from './tip-popup'
import cn from '@/utils/classnames'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { getNodesBounds, useReactFlow } from 'reactflow'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

const MoreActions: FC = () => {
  const { t } = useTranslation()
  const { getNodesReadOnly } = useNodesReadOnly()
  const reactFlow = useReactFlow()

  const appDetail = useAppStore(s => s.appDetail)
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewTitle, setPreviewTitle] = useState('')

  const handleExportImage = useCallback(async (type: 'png' | 'jpeg' | 'svg', currentWorkflow = false) => {
    if (!appDetail)
      return

    if (getNodesReadOnly())
      return

    setOpen(false)
    const flowElement = document.querySelector('.react-flow__viewport') as HTMLElement
    if (!flowElement) return

    try {
      const filter = (node: HTMLElement) => {
        if (node instanceof HTMLImageElement)
          return node.complete && node.naturalHeight !== 0

        return true
      }

      let dataUrl
      let filename = `${appDetail.name}`

      if (currentWorkflow) {
        const nodes = reactFlow.getNodes()
        const nodesBounds = getNodesBounds(nodes)

        const currentViewport = reactFlow.getViewport()

        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const zoom = Math.min(
          viewportWidth / (nodesBounds.width + 100),
          viewportHeight / (nodesBounds.height + 100),
          1,
        )

        const centerX = nodesBounds.x + nodesBounds.width / 2
        const centerY = nodesBounds.y + nodesBounds.height / 2

        reactFlow.setViewport({
          x: viewportWidth / 2 - centerX * zoom,
          y: viewportHeight / 2 - centerY * zoom,
          zoom,
        })

        await new Promise(resolve => setTimeout(resolve, 300))

        const padding = 50
        const contentWidth = nodesBounds.width + padding * 2
        const contentHeight = nodesBounds.height + padding * 2

        const exportOptions = {
          filter,
          backgroundColor: '#1a1a1a',
          pixelRatio: 2,
          width: contentWidth,
          height: contentHeight,
          style: {
            width: `${contentWidth}px`,
            height: `${contentHeight}px`,
            transform: `translate(${padding - nodesBounds.x}px, ${padding - nodesBounds.y}px) scale(${zoom})`,
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

        setTimeout(() => {
          reactFlow.setViewport(currentViewport)
        }, 500)
      }
      else {
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
        setPreviewUrl(dataUrl)
        setPreviewTitle(`${filename}.${type}`)

        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `${filename}.${type}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      else {
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
  }, [getNodesReadOnly, appDetail, reactFlow])

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
        placement="bottom-end"
        offset={{
          mainAxis: -200,
          crossAxis: 40,
        }}
      >
        <PortalToFollowElemTrigger>
          <TipPopup title={t('workflow.common.moreActions')}>
            <div
              className={cn(
                'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
                `${getNodesReadOnly() && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
              )}
              onClick={handleTrigger}
            >
              <RiMoreFill className='h-4 w-4' />
            </div>
          </TipPopup>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-10'>
          <div className='min-w-[180px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur text-text-secondary shadow-lg'>
            <div className='p-1'>
              <div className='flex items-center gap-2 px-2 py-1 text-xs font-medium text-text-tertiary'>
                <RiExportLine className='h-3 w-3' />
                {t('workflow.common.exportImage')}
              </div>
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

export default memo(MoreActions)
