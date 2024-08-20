"use client";
import * as React from "react";
import { Button } from "@/app/components/base/button";
import SiteLogo from "@/app/components/base/logo/logo-site";
import Link from "next/link";

export default function navbar() {
  const handleNavigation = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav className="fixed top-2 left-0 right-0  text-black  z-[1000]  p-4  ">
      <div className="flex max-w-7xl  bg-white mx-auto justify-between items-center border px-2 rounded-full   h-[48px] backdrop-blur-xl">
        <div className="flex items-center gap-3 ">
          <Link href="/" className="flex gap-2 items-center">
            <>
              <SiteLogo />
            </>
            <span className="font-medium text-xl">ChatbotX</span>
          </Link>
        </div>

        <div className="flex  items-center gap-3 text-sm">
          <Link href="/billing" className="cursor-pointer hidden md:block">
            Plans
          </Link>
          <div
            onClick={() => handleNavigation("features")}
            className="cursor-pointer hidden md:block"
          >
            Features
          </div>
          <div
            onClick={() => handleNavigation("integrations")}
            className="cursor-pointer hidden md:block"
          >
            Integration
          </div>

          <div className="">
            <Link href="/studio" className="cursor-pointer">
              <Button
                className="rounded-2xl"
                variant={"primary"}
                size={"small"}
              >
                Create a Chatbot
              </Button>
            </Link>
          </div>

          <div className="hidden md:block">
            <Link href="/signin" className="cursor-pointer">
              <Button
                className="rounded-2xl"
                variant={"secondary"}
                size={"small"}
              >
                Login
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
