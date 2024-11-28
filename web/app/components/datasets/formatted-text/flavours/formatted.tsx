import type { FC, PropsWithChildren } from 'react'

export type FormattedTextProps = PropsWithChildren

export const FormattedText: FC<FormattedTextProps> = (props) => {
  return <p className='leading-7'>{props.children}</p>
}
