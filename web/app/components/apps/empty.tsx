import * as React from 'react'

const DefaultCards = React.memo(() => {
  const renderArray = Array.from({ length: 36 })
  return (
    <>
      {
        renderArray.map((_, index) => (
          <div
            key={index}
            className="inline-flex h-[160px] rounded-xl bg-background-default-lighter"
          />
        ))
      }
    </>
  )
})

type Props = {
  message: string
}

const Empty = ({ message }: Props) => {
  return (
    <>
      <DefaultCards />
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-linear-to-t from-background-body to-transparent">
        <span className="system-md-medium text-text-tertiary">
          {message}
        </span>
      </div>
    </>
  )
}

export default React.memo(Empty)
