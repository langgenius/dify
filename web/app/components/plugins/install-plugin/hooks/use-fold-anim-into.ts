import { sleep } from '@/utils'

const animTime = 750
const modalClassName = 'install-modal'
const COUNT_DOWN_TIME = 15000 // 15s

function getElemCenter(elem: HTMLElement) {
  const rect = elem.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 + window.scrollX,
    y: rect.top + rect.height / 2 + window.scrollY,
  }
}

const useFoldAnimInto = (onClose: () => void) => {
  let countDownRunId: number
  const clearCountDown = () => {
    clearTimeout(countDownRunId)
  }
  // modalElem fold into plugin install task btn
  const foldIntoAnim = async () => {
    clearCountDown()
    const modalElem = document.querySelector(`.${modalClassName}`) as HTMLElement
    const pluginTaskTriggerElem = document.getElementById('plugin-task-trigger') || document.querySelector('.plugins-nav-button')

    if (!modalElem || !pluginTaskTriggerElem) {
      onClose()
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
    onClose()
  }

  const countDownFoldIntoAnim = async () => {
    countDownRunId = window.setTimeout(() => {
      foldIntoAnim()
    }, COUNT_DOWN_TIME)
  }

  return {
    modalClassName,
    foldIntoAnim,
    clearCountDown,
    countDownFoldIntoAnim,
  }
}

export default useFoldAnimInto
