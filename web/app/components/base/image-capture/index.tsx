import { useCallback, useState } from 'react'
import html2canvas from 'html2canvas'

export const useImageCapture = (title: string, isMobile: boolean) => {
  const [capturedImage, setCapturedImage] = useState<string | null>(null)

  const captureImage = useCallback(async (elementId: string) => {
    try {
      const element = document.getElementById(elementId)
      if (!element)
        throw new Error(`Element with id "${elementId}" not found`)

      // Wait for font to load before capturing image
      await document.fonts.ready

      // Applied style repairs for html2canvas compatibility
      const originalStyles = applyStyleFixes(element)

      // Add wrapper div
      const wrapper = addWrapperDiv(element, title, isMobile)

      // Wait for dynamic content to load (example: Wait 1 second)
      await new Promise(resolve => setTimeout(resolve, 1000))

      const canvas = await html2canvas(wrapper, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        logging: false,
        windowWidth: wrapper.scrollWidth,
        windowHeight: wrapper.scrollHeight,
      })

      // Remove wrapper div
      removeWrapperDiv(element, wrapper)

      // Restore original style
      restoreStyles(element, originalStyles)

      // Apply rounded corners
      const roundedCanvas = applyRoundedCorners(canvas, 20)

      const image = roundedCanvas.toDataURL('image/png')
      setCapturedImage(image)
      return image
    }
    catch (error) {
      console.error('Error capturing image:', error)
      return null
    }
  }, [isMobile, title])

  return { capturedImage, captureImage }
}

function addWrapperDiv(element: HTMLElement, title: string, isMobile: boolean): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: ${element.offsetWidth}px;
    height: ${element.offsetHeight + 64}px;
    background-color: white;
    overflow: hidden;
  `
  const titleBar = document.createElement('div')
  if (isMobile) {
    titleBar.innerHTML = `
      <div class='sticky top-0 flex items-center justify-center px-8 bg-white/80 text-base font-medium text-gray-900 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10 h-12'>
        ${title}
      </div>
    `
  }
  else {
    titleBar.innerHTML = `
      <div class='sticky top-0 flex items-center justify-center px-8 h-16 bg-white/80 text-base font-medium text-gray-900 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10'>
        ${title}
      </div>
    `
  }
  wrapper.appendChild(titleBar)

  const contentContainer = document.createElement('div')
  contentContainer.style.cssText = `
    position: absolute;
    top: 64px;
    left: 0;
    width: 100%;
    height: calc(100% - 64px);
    overflow: auto;
  `

  // Clone the original element to preserve its content and style
  const clonedElement = element.cloneNode(true) as HTMLElement
  contentContainer.appendChild(clonedElement)
  wrapper.appendChild(contentContainer)

  element.parentNode?.insertBefore(wrapper, element)
  element.style.display = 'none'
  return wrapper
}

function applyRoundedCorners(sourceCanvas: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    console.error('Unable to get 2D context')
    return sourceCanvas
  }

  const width = sourceCanvas.width
  const height = sourceCanvas.height

  canvas.width = width
  canvas.height = height

  context.beginPath()
  context.moveTo(radius, 0)
  context.lineTo(width - radius, 0)
  context.quadraticCurveTo(width, 0, width, radius)
  context.lineTo(width, height - radius)
  context.quadraticCurveTo(width, height, width - radius, height)
  context.lineTo(radius, height)
  context.quadraticCurveTo(0, height, 0, height - radius)
  context.lineTo(0, radius)
  context.quadraticCurveTo(0, 0, radius, 0)
  context.closePath()

  context.clip()
  context.drawImage(sourceCanvas, 0, 0, width, height)

  return canvas
}

function removeWrapperDiv(originalElement: HTMLElement, wrapper: HTMLElement) {
  wrapper.parentNode?.removeChild(wrapper)
  originalElement.style.display = ''
}

function applyStyleFixes(element: HTMLElement): Map<HTMLElement, string> {
  const originalStyles = new Map<HTMLElement, string>()

  const applyFix = (el: HTMLElement) => {
    originalStyles.set(el, el.style.cssText)
    el.style.visibility = 'visible'
    if (window.getComputedStyle(el).position === 'fixed')
      el.style.position = 'absolute'

    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement)
        applyFix(child)
    })
  }

  applyFix(element)
  return originalStyles
}

function restoreStyles(element: HTMLElement, originalStyles: Map<HTMLElement, string>) {
  const restoreStyle = (el: HTMLElement) => {
    if (originalStyles.has(el))
      el.style.cssText = originalStyles.get(el) || ''

    Array.from(el.children).forEach((child) => {
      if (child instanceof HTMLElement)
        restoreStyle(child)
    })
  }

  restoreStyle(element)
}
