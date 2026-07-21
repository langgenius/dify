import { createContext, use } from 'react'
import { defaultHumanInputV2FormTransport } from './transport-selector'

export const HumanInputV2FormTransportContext = createContext(defaultHumanInputV2FormTransport)

export const useHumanInputV2FormTransport = () => use(HumanInputV2FormTransportContext)
