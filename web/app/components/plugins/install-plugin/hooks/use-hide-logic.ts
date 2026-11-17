import { useEffect, useRef, useState } from 'react'
import createFoldAnimInto from './create-fold-anim-into'

const useHideLogic = (onClose: () => void) => {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const [controller] = useState(() => createFoldAnimInto(() => onCloseRef.current()))
  useEffect(() => controller.clearCountDown, [controller])

  return {
    popupRef: controller.popupRef,
    foldAnimInto: controller.requestClose,
    foldIntoTaskTrigger: controller.foldIntoAnim,
    setIsInstalling: controller.setIsInstalling,
    handleStartToInstall: controller.startInstalling,
  }
}

export default useHideLogic
