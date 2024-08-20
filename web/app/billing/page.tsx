import React from "react";
import Billing from "@/app/components/billing/pricing";
import Navbar from "@/app/components/landing/navbar";

export default function page() {
  return (
    <>
      <Navbar />
      <Billing />;
    </>
  );
}
