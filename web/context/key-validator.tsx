import { createContext, useContext } from 'use-context-selector'
import { useEventEmitter } from 'ahooks'
import type { EventEmitter } from 'ahooks/lib/useEventEmitter'

const KeyValidatorContext = createContext<{ trigger: EventEmitter<string> | null }>({
  trigger: null,
})

export const useKeyValidatorContext = () => useContext(KeyValidatorContext)

type KeyValidatorContextProviderProps = {
  children: React.ReactNode
}
export const KeyValidatorContextProvider = ({
  children,
}: KeyValidatorContextProviderProps) => {
  const trigger = useEventEmitter<string>()

  return (
    <KeyValidatorContext.Provider value={{ trigger }}>
      {children}
    </KeyValidatorContext.Provider>
  )
}

export default KeyValidatorContext
