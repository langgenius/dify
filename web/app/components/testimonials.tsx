import React from "react";
import Image from "next/image";
import Marquee from "@/app/components/marquee";

export function Testimonial() {
  const images = [
    "/companies/one.svg",
    "/companies/two.svg",
    "/companies/three.svg",
    "/companies/five.svg",
    "/companies/six.svg",
    "/companies/seven.svg",
  ];

  return (
    <div className="py-8 flex  flex-col mb-10">
      <h1 className="text-center">Trusted by 5000+ Teams</h1>
      <Marquee className="[--duration:30s] [--gap:6rem]">
        {images.map((image, index) => (
          <div
            key={index + "-testimonials"}
            className="p-2 flex items-center justify-center"
          >
            <Image
              src={image}
              alt="image"
              width={100}
              height={100}
              className="object-contain"
            />
          </div>
        ))}
      </Marquee>
    </div>
  );
}
