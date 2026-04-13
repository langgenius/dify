import { memo } from 'react'

type LineProps = {
  list: number[]
}
const Line = ({
  list,
}: LineProps) => {
  const listHeight = list.map((item) => {
    return item * 36 + (item - 1) * 2 + 12 + 6
  })
  const processedList = listHeight.map((item, index) => {
    if (index === 0)
      return item

    return listHeight.slice(0, index).reduce((acc, cur) => acc + cur, 0) + item
  })
  const processedListLength = processedList.length
  const svgHeight = processedList[processedListLength - 1] + (processedListLength - 1) * 8

  return (
    <svg className="w-6 shrink-0" style={{ height: svgHeight }}>
      {
        processedList.map((item, index) => {
          const prevItem = index > 0 ? processedList[index - 1] : 0
          const space = prevItem + index * 8 + 16
          return (
            <g key={index}>
              {
                index === 0 && (
                  <>
                    <path
                      d="M0,18 L24,18"
                      strokeWidth={1}
                      fill="none"
                      className="stroke-divider-solid"
                    />
                    <rect
                      x={0}
                      y={16}
                      width={1}
                      height={4}
                      className="fill-divider-solid-alt"
                    />
                  </>
                )
              }
              {
                index > 0 && (
                  <path
                    d={`M0,18 Q12,18 12,28 L12,${space - 10 + 2} Q12,${space + 2} 24,${space + 2}`}
                    strokeWidth={1}
                    fill="none"
                    className="stroke-divider-solid"
                  />
                )
              }
              <rect
                x={23}
                y={space}
                width={1}
                height={4}
                className="fill-divider-solid-alt"
              />
            </g>
          )
        })
      }
    </svg>
  )
}

export default memo(Line)
