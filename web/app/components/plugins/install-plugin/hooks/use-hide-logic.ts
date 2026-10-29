import { useCallback, useEffect, useRef, useState } from 'react'
import createFoldAnimInto from './create-fold-anim-into'

const useHideLogic = (onClose: () => void) => {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const [controller] = useState(() => createFoldAnimInto(() => onCloseRef.current()))
  const {
    modalClassName,
    foldIntoAnim: doFoldAnimInto,
    clearCountDown,
    countDownFoldIntoAnim,
  } = controller

  useEffect(() => clearCountDown, [clearCountDown])

  const [isInstalling, doSetIsInstalling] = useState(false)
  const setIsInstalling = useCallback(
    (isInstalling: boolean) => {
      if (!isInstalling) clearCountDown()
      doSetIsInstalling(isInstalling)
    },
    [clearCountDown],
  )

  const foldAnimInto = useCallback(() => {
    if (isInstalling) {
      doFoldAnimInto()
      return
    }
    onClose()
  }, [doFoldAnimInto, isInstalling, onClose])

  const handleStartToInstall = useCallback(() => {
    setIsInstalling(true)
    countDownFoldIntoAnim()
  }, [countDownFoldIntoAnim, setIsInstalling])

  return {
    modalClassName,
    foldAnimInto,
    foldIntoTaskTrigger: doFoldAnimInto,
    setIsInstalling,
    handleStartToInstall,
  }
}

export default useHideLogic
