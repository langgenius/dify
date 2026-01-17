type VerticalLineProps = {
  className?: string
}
const VerticalLine = ({
  className,
}: VerticalLineProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="2" height="132" viewBox="0 0 2 132" fill="none" className={className}>
      <path d="M1 0L1 132" stroke="url(#paint0_linear_8619_59128)" />
      <defs>
        <linearGradient id="paint0_linear_8619_59128" x1="-7.99584" y1="132" x2="-7.96108" y2="6.4974e-07" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.01" />
          <stop offset="0.877606" stopColor="#101828" stopOpacity="0.04" />
          <stop offset="1" stopColor="white" stopOpacity="0.01" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default VerticalLine
