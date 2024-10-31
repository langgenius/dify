type LineProps = {
  className?: string
}
const Line = ({
  className,
}: LineProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="2" height="241" viewBox="0 0 2 241" fill="none" className={className}>
      <path d="M1 0.5L1 240.5" stroke="url(#paint0_linear_1989_74474)"/>
      <defs>
        <linearGradient id="paint0_linear_1989_74474" x1="-7.99584" y1="240.5" x2="-7.88094" y2="0.50004" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.01"/>
          <stop offset="0.503965" stopColor="#101828" stopOpacity="0.08"/>
          <stop offset="1" stopColor="white" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

export default Line
