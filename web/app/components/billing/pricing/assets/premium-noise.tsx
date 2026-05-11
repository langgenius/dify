const PremiumNoise = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="148" viewBox="0 0 100% 148" fill="none">
      <g opacity="0.05" filter="url(#filter0_g_1_5238)">
        <rect y="0" width="100%" height="96" fill="var(--color-text-warning)" />
      </g>
      <defs>
        <filter id="filter0_g_1_5238" x="0" y="0" width="100%" height="296" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feTurbulence type="fractalNoise" baseFrequency="0.625 0.625" numOctaves="3" seed="5427" />
          <feDisplacementMap in="shape" scale="200" xChannelSelector="R" yChannelSelector="G" result="displacedImage" width="100%" height="100%" />
          <feMerge result="effect1_texture_1_5238">
            <feMergeNode in="displacedImage" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  )
}

export default PremiumNoise
