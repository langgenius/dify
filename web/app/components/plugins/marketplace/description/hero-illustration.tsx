'use client'

// todo: update the illustration
const HeroIllustration = () => {
  return (
    <svg
      width="280"
      height="160"
      viewBox="0 0 280 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute right-0 top-1/2 -translate-y-1/2 opacity-80"
    >
      {/* Large circle - top right */}
      <circle
        cx="220"
        cy="40"
        r="60"
        fill="url(#gradient1)"
        fillOpacity="0.3"
      />
      {/* Medium circle - middle */}
      <circle
        cx="180"
        cy="100"
        r="40"
        fill="url(#gradient2)"
        fillOpacity="0.4"
      />
      {/* Small circle - bottom */}
      <circle
        cx="240"
        cy="120"
        r="25"
        fill="url(#gradient3)"
        fillOpacity="0.5"
      />
      {/* Decorative dots */}
      <circle cx="140" cy="60" r="4" fill="white" fillOpacity="0.6" />
      <circle cx="160" cy="45" r="3" fill="white" fillOpacity="0.4" />
      <circle cx="130" cy="90" r="5" fill="white" fillOpacity="0.5" />
      <circle cx="200" cy="70" r="3" fill="white" fillOpacity="0.3" />
      {/* Abstract shapes */}
      <rect
        x="150"
        y="110"
        width="30"
        height="30"
        rx="8"
        fill="white"
        fillOpacity="0.15"
        transform="rotate(-15 150 110)"
      />
      <rect
        x="100"
        y="50"
        width="20"
        height="20"
        rx="4"
        fill="white"
        fillOpacity="0.1"
        transform="rotate(10 100 50)"
      />
      {/* Gradient definitions */}
      <defs>
        <radialGradient id="gradient1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="white" stopOpacity="0.6" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gradient2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gradient3" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="white" stopOpacity="0.7" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}

export default HeroIllustration
