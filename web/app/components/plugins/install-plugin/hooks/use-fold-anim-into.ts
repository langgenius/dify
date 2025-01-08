import { sleep } from '@/utils'

// modalElem fold into plugin install task btn
const animTime = 2000

function getElemCenter(elem: HTMLElement) {
  const rect = elem.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 + window.scrollX,
    y: rect.top + rect.height / 2 + window.scrollY,
  }
}

const useFoldAnimInto = (onClose: () => void) => {
  return async function foldIntoAnim(modalClassName: string) {
    const modalElem = document.querySelector(`.${modalClassName}`) as HTMLElement
    const pluginTaskTriggerElem = document.getElementById('plugin-task-trigger')

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
}

export default useFoldAnimInto
