"use client";

import React from "react";
import { Card, CardHeader, CardBody, CardFooter } from "@nextui-org/card";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
import Image from "next/image";

interface FeatCardProps {
  targetElement: string;
  className: string;
  imageUrl: string;
  title: string;
}

export default function FeatCard({
  targetElement,
  className,
  imageUrl,
  title,
}: FeatCardProps) {
  function handleClick() {
    const element = document.getElementById(targetElement);

    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <Card
      isPressable
      className={cn("aspect-[1.02] text-white p-0")}
      onClick={handleClick}
    >
      <div
        className={cn(
          "grid h-full w-full grid-rows-4 bg-blue-700 hover:bg-blue-600 "
        )}
      >
        <div className={cn("row-span-3 h-full w-full  p-4 pb-0 ", className)}>
          <div className="relative h-full w-full  rounded-t-md overflow-hidden">
            <Image
              alt="image"
              src={imageUrl}
              className="object-contain object-top  "
              fill
              sizes="100vw"
            />
          </div>
        </div>

        <div className="text-center  flex justify-center items-center transition-all h-full  p-3 ">
          <h3 className="text-lg max-w-md text-center font-semibold">
            {title}
          </h3>
        </div>
      </div>
    </Card>
  );
}
