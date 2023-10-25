'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useState } from 'react'
import { createContext, useContext } from 'use-context-selector'
import ApiBasedExtensionModal from '@/app/components/header/account-setting/api-based-extension-page/modal'
import type { ApiBasedExtensionData } from '@/app/components/header/account-setting/api-based-extension-page/modal'

const ApiBasedExtensionContext = createContext<{
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ApiBasedExtensionData | null>>
}>({
  setShowApiBasedExtensionModal: () => {},
})

export const useApiBasedExtensionContext = () => useContext(ApiBasedExtensionContext)

type ApiBasedExtensionContextProviderProps = {
  children: React.ReactNode
}
export const ApiBasedExtensionContextProvider = ({
  children,
}: ApiBasedExtensionContextProviderProps) => {
  const [showApiBasedExtensionModal, setShowApiBasedExtensionModal] = useState<ApiBasedExtensionData | null>(null)

  return (
    <ApiBasedExtensionContext.Provider value={{
      setShowApiBasedExtensionModal,
    }}>
      <>
        {children}
        {
          !!showApiBasedExtensionModal && (
            <ApiBasedExtensionModal
              data={showApiBasedExtensionModal}
              onCancel={() => setShowApiBasedExtensionModal(null)}
            />
          )
        }
      </>
    </ApiBasedExtensionContext.Provider>
  )
}

export default ApiBasedExtensionContext
