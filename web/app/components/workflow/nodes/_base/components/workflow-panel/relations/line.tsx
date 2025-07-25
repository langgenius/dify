import { memo } from 'react'
import { RelationType } from './types'

type LineProps = {
  rowCount: number
  relationType: RelationType
}
const Line = ({
  rowCount = 1,
  relationType,
}: LineProps) => {
  const list: number[] = []
  const listH = 40
  const ySpacing = 8

  const svgHeight = listH * rowCount + ySpacing * (rowCount - 1)

  const lineWidth = 48
  const arrowStrokeWidth = 1
  const arrowLineLength = 6

  return (
    <svg className='w-12 shrink-0' style={{ height: svgHeight }}>
      {
        Array.from({ length: rowCount }).map((_, index) => {
          const space = index * listH + index * ySpacing + 16
          return (
            <g key={index}>
              {
                index === 0 && (
                  <>
                    <path
                      d={`M0,18 L${lineWidth},18`}
                      strokeWidth={1}
                      fill='none'
                      className='stroke-divider-solid'
                    />
                    <path
                      d={relationType === RelationType.dependencies
                        ? `M${6 + arrowLineLength},${18 - arrowLineLength} L6,${18} L${6 + arrowLineLength},${18 + arrowLineLength}`
                        : `M${lineWidth - 6 - arrowLineLength},${18 - arrowLineLength} L${lineWidth - 6},${18} L${lineWidth - 6 - arrowLineLength},${18 + arrowLineLength}`
                      }
                      strokeWidth={arrowStrokeWidth}
                      fill='none'
                      className='stroke-divider-solid-alt'
                    />
                    <rect
                      x={lineWidth - 1}
                      y={16}
                      width={1}
                      height={4}
                      className='fill-divider-solid-alt'
                    />
                  </>
                )
              }
              {
                index > 0 && (
                  <>
                    <path
                      d={(`M0,18 L${lineWidth / 2 - 12},18 Q${lineWidth / 2},18 ${lineWidth / 2},28 L${lineWidth / 2},${space - 10 + 2} Q${lineWidth / 2},${space + 2} ${lineWidth / 2 + 12},${space + 2} L${lineWidth},${space + 2}`)}
                      strokeWidth={1}
                      fill='none'
                      className='stroke-divider-solid'
                    />
                    {relationType === RelationType.dependents && (
                      <path
                        d={`M${lineWidth - 6 - arrowLineLength},${space + 2 - arrowLineLength} L${lineWidth - 6},${space + 2} L${lineWidth - 6 - arrowLineLength},${space + 2 + arrowLineLength}`}
                        strokeWidth={arrowStrokeWidth}
                        fill='none'
                        className='stroke-divider-solid-alt'
                      />
                    )}
                  </>
                )
              }
              <rect
                x={lineWidth - 1}
                y={space}
                width={1}
                height={4}
                className='fill-divider-solid-alt'
              />
            </g>
          )
        })
      }
    </svg>
  )
}

export default memo(Line)
