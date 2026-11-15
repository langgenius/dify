import { createRef } from 'react'
import { sleep } from '@/utils'

const animTime = 750
const COUNT_DOWN_TIME = 15000 // 15s

function getElemCenter(elem: HTMLElement) {
  const rect = elem.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 + window.scrollX,
    y: rect.top + rect.height / 2 + window.scrollY,
  }
}

const createFoldAnimInto = (onClose: () => void) => {
  const popupRef = createRef<HTMLDivElement>()
  let active = true
  let isInstalling = false
  const close = () => {
    if (active) onClose()
  }
  let countDownRunId: number
  const clearCountDown = () => {
    clearTimeout(countDownRunId)
  }
  // modalElem fold into plugin install task btn
  const foldIntoAnim = async () => {
    clearCountDown()
    const modalElem = popupRef.current
    const pluginTaskTriggerElem =
      document.getElementById('plugin-task-trigger') ||
      document.querySelector('.plugins-nav-button')

    if (!modalElem || !pluginTaskTriggerElem) {
      close()
      return
    }

    const modelCenter = getElemCenter(modalElem)
    const modalElemRect = modalElem.getBoundingClientRect()
    const pluginTaskTriggerCenter = getElemCenter(pluginTaskTriggerElem)
    const xDiff = pluginTaskTriggerCenter.x - modelCenter.x
    const yDiff = pluginTaskTriggerCenter.y - modelCenter.y
    const scale = 1 / Math.max(modalElemRect.width, modalElemRect.height)
    modalElem.style.transition = `all cubic-bezier(0.4, 0, 0.2, 1) ${animTime}ms`
    modalElem.style.transform = `translate(${xDiff}px, ${yDiff}px) scale(${scale})`
    await sleep(animTime)
    close()
  }

  return {
    popupRef,
    close,
    requestClose: () => {
      if (isInstalling) void foldIntoAnim()
      else close()
    },
    dispose: () => {
      active = false
      clearCountDown()
    },
    startInstalling: () => {
      isInstalling = true
      clearCountDown()
      countDownRunId = window.setTimeout(foldIntoAnim, COUNT_DOWN_TIME)
    },
    setIsInstalling: (value: boolean) => {
      isInstalling = value
      if (!value) clearCountDown()
    },
    foldIntoAnim,
    clearCountDown,
  }
}

export default createFoldAnimInto
