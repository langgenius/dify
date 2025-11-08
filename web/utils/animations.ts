'use client'

import { useEffect } from 'react'

// Debounce function to limit the rate of function execution
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<F>): void => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), waitFor)
  }
}

// 3D Tilt Effect
export const useTiltEffect = (ref: React.RefObject<HTMLElement>) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY, currentTarget } = e
      const { left, top, width, height } = (currentTarget as HTMLElement).getBoundingClientRect()
      const x = (clientX - left) / width - 0.5
      const y = (clientY - top) / height - 0.5
      element.style.transform = `perspective(1000px) rotateY(${x * 20}deg) rotateX(${-y * 20}deg) scale3d(1.05, 1.05, 1.05)`
    }

    const handleMouseLeave = () => {
      element.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg) scale3d(1, 1, 1)'
    }

    element.addEventListener('mousemove', handleMouseMove)
    element.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      element.removeEventListener('mousemove', handleMouseMove)
      element.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [ref])
}

// Magnetic Button Effect
export const useMagneticEffect = (ref: React.RefObject<HTMLElement>, strength = 20) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e
      const { left, top, width, height } = element.getBoundingClientRect()
      const x = clientX - (left + width / 2)
      const y = clientY - (top + height / 2)
      element.style.transform = `translate(${x * (strength / 100)}px, ${y * (strength / 100)}px)`
    }

    const handleMouseLeave = () => {
      element.style.transform = 'translate(0px, 0px)'
    }

    const parent = element.parentElement
    if (!parent) return

    parent.addEventListener('mousemove', handleMouseMove)
    parent.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      parent.removeEventListener('mousemove', handleMouseMove)
      parent.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [ref, strength])
}

// Scroll-Triggered Fade-In
export const useRevealEffect = (ref: React.RefObject<HTMLElement>) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add('is-visible')
          observer.unobserve(element)
        }
      },
      {
        threshold: 0.1,
      }
    )

    observer.observe(element)

    return () => {
      if (element) {
        observer.unobserve(element)
      }
    }
  }, [ref])
}

// Parallax Effect
export const useParallaxEffect = (ref: React.RefObject<HTMLElement>, speed = 0.5) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    let animationFrameId: number

    const update = () => {
      const yOffset = window.pageYOffset
      element.style.transform = `translateY(${yOffset * speed}px)`
      animationFrameId = requestAnimationFrame(update)
    }

    const handleScroll = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(update)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    update() // Initial call

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      window.removeEventListener('scroll', handleScroll)
    }
  }, [ref, speed])
}
