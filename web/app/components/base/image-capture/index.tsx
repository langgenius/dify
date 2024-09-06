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

      const canvas = await html2canvas(element, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        logging: false,
        onclone: (cloneDocument, clonedElement) => {
          // Store original content and styles
          const originalContent = clonedElement.innerHTML
          const originalStyles = applyStyleFixes(clonedElement)

          // Clear the cloned element
          clonedElement.innerHTML = ''

          // Create and add title bar
          const titleBar = cloneDocument.createElement('div')
          titleBar.innerHTML = isMobile
            ? `<div class='sticky top-0 flex items-start justify-center px-8 h-8 bg-white/80 font-medium text-gray-900 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10'>${title}</div>`
            : `<div class='sticky top-0 flex items-start justify-center px-8 h-10 bg-white/80 font-medium text-gray-900 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10'>${title}</div>`
          // wrapper.appendChild(titleBar)
          clonedElement.appendChild(titleBar)

          // Create a container for the original content
          const contentContainer = cloneDocument.createElement('div')
          contentContainer.style.cssText = `
            position: absolute;
            width: ${element.offsetWidth}px;
            height: calc(100% - 64px);
            overflow: hidden;
          `
          contentContainer.innerHTML = originalContent

          // Copy computed styles from original element to contentContainer
          const computedStyle = window.getComputedStyle(element)
          for (let i = 0; i < computedStyle.length; i++) {
            const property = computedStyle[i]
            contentContainer.style.setProperty(property, computedStyle.getPropertyValue(property))
          }

          // Set the wrapper as the content of clonedElement
          clonedElement.appendChild(contentContainer)

          // Adjust the cloned element's style
          clonedElement.style.cssText = `
            ${originalStyles}
            top: 0;
            width: 100%;
            height: ${element.offsetHeight + 100}px;
            background-color: white;
            overflow: hidden;
          `
          return () => {
            // No need to restore styles as we're using a wrapper
          }
        },
      })

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
