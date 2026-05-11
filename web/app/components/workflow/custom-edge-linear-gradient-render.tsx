type CustomEdgeLinearGradientRenderProps = {
  id: string
  startColor: string
  stopColor: string
  position: {
    x1: number
    x2: number
    y1: number
    y2: number
  }
}
const CustomEdgeLinearGradientRender = ({
  id,
  startColor,
  stopColor,
  position,
}: CustomEdgeLinearGradientRenderProps) => {
  const {
    x1,
    x2,
    y1,
    y2,
  } = position
  return (
    <defs>
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
      >
        <stop
          offset="0%"
          style={{
            stopColor: startColor,
            stopOpacity: 1,
          }}
        />
        <stop
          offset="100%"
          style={{
            stopColor,
            stopOpacity: 1,
          }}
        />
      </linearGradient>
    </defs>
  )
}

export default CustomEdgeLinearGradientRender
