"use client";
import React from "react";
import { AccountSettings } from "../../components/header/account-setting";

export default function page() {
  return (
    <div className="bg-background">
      <AccountSettings onCancel={() => {}} />
    </div>
  );
}
