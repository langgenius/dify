import { useCallback, useState } from 'react'
import useFoldAnimInto from './use-fold-anim-into'

const useHideLogic = (onClose: () => void) => {
  const {
    modalClassName,
    foldIntoAnim: doFoldAnimInto,
    clearCountDown,
    countDownFoldIntoAnim,
  } = useFoldAnimInto(onClose)

  const [isInstalling, doSetIsInstalling] = useState(false)
  const setIsInstalling = useCallback((isInstalling: boolean) => {
    if (!isInstalling)
      clearCountDown()
    doSetIsInstalling(isInstalling)
  }, [clearCountDown])

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
    setIsInstalling,
    handleStartToInstall,
  }
}

export default useHideLogic
