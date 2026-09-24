import type { ReactNode } from 'react'

export type IAppDetail = {
  children: ReactNode
}

const AppDetail = ({ children }: IAppDetail) => children

export default AppDetail
