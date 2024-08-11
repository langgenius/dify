"use client";

import React from "react";

export default function page() {
  return (
    <div>
      <iframe
        src="http://127.0.0.1:3000/chatbot/kF3vftmb6m6LRsSW"
        style={{
          width: "100%",
          height: "100%",
          minHeight: "700px",
        }}
        //  frameborder="0"
        allow="microphone"
      ></iframe>
    </div>
  );
}
