import type { ButtonHTMLAttributes } from 'react'

type ElementProps = {
  className?: string
  children?: React.ReactNode
  [key: string]: unknown
}

type IBasePaginationProps = {
  currentPage: number
  setCurrentPage: (page: number) => void
  truncableText?: string
  truncableClassName?: string
}

type IPaginationProps = IBasePaginationProps & {
  totalPages: number
  edgePageCount: number
  middlePagesSiblingCount: number
  className?: string
  children?: React.ReactNode
}

type IUsePagination = IBasePaginationProps & {
  pages: number[]
  hasPreviousPage: boolean
  hasNextPage: boolean
  previousPages: number[]
  isPreviousTruncable: boolean
  middlePages: number[]
  isNextTruncable: boolean
  nextPages: number[]
}

type IPagination = IUsePagination & {
  setCurrentPage: (page: number) => void
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: React.ReactElement<ElementProps>
  children?: string | React.ReactNode
  className?: string
  dataTestId?: string
}

type PageButtonProps = ButtonProps & {
  /**
   * Provide a custom ReactElement (e.g. Next/Link)
   */
  as?: React.ReactElement<ElementProps>
  activeClassName?: string
  inactiveClassName?: string
  dataTestIdActive?: string
  dataTestIdInactive?: string
  renderExtraProps?: (pageNum: number) => {}
}

export type {
  IPaginationProps,
  IUsePagination,
  IPagination,
  ButtonProps,
  PageButtonProps,
}
