type CustomEdgeLinearGradientRenderProps = {
  id: string
  startColor: string
  stopColor: string
}
const CustomEdgeLinearGradientRender = ({
  id,
  startColor,
  stopColor,
}: CustomEdgeLinearGradientRenderProps) => {
  return (
    <defs>
      <linearGradient
        id={id}
        x1='0%'
        y1='0%'
        x2='100%'
        y2='0%'
      >
        <stop
          offset='0%'
          style={{
            stopColor: startColor,
            stopOpacity: 1,
          }}
        />
        <stop
          offset='1'
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
