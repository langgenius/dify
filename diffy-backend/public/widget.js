(function () {
  const BACKEND_URL =
    document.currentScript.getAttribute("data-backend") || "";

  // --- Inject styles ---

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #chatkit-bubble {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #000;
        color: #fff;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
      }
      #chatkit-bubble:hover {
        transform: scale(1.1);
      }
      #chatkit-bubble svg {
        width: 24px;
        height: 24px;
        fill: #fff;
      }
      #chatkit-panel {
        position: fixed;
        bottom: 96px;
        right: 24px;
        width: 400px;
        height: 600px;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 99998;
        display: none;
        background: #fff;
      }
      #chatkit-panel.open {
        display: block;
      }
      #chatkit-panel iframe {
        width: 100%;
        height: 100%;
        border: 0;
      }
      @media (max-width: 480px) {
        #chatkit-panel {
          width: calc(100vw - 16px);
          height: calc(100vh - 120px);
          right: 8px;
          bottom: 88px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // --- Ask the backend which Diffy agent (if any) applies to this page ---
  // Returns { ok, name, iframe_url } or null if none is configured.

  async function checkAgent() {
    try {
      const res = await fetch(BACKEND_URL + "/diffy-iframe/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_url: window.location.href }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // --- Boot: only show the widget once we know there's a matching agent ---

  async function init() {
    const info = await checkAgent();
    if (!info || !info.iframe_url) return;

    injectStyles();

    const bubble = document.createElement("button");
    bubble.id = "chatkit-bubble";
    bubble.setAttribute("aria-label", "Open chat");
    bubble.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    document.body.appendChild(bubble);

    const panel = document.createElement("div");
    panel.id = "chatkit-panel";

    const iframe = document.createElement("iframe");
    iframe.src = info.iframe_url;
    iframe.title = info.name || "Chat";
    iframe.allow = "microphone";
    panel.appendChild(iframe);

    document.body.appendChild(panel);

    let isOpen = false;
    bubble.addEventListener("click", function () {
      isOpen = !isOpen;
      panel.classList.toggle("open", isOpen);
    });
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
