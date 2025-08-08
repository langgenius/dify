/** this file is used to embed the chatbot in a website
 * the difyChatbotConfig should be defined in the html file before this script is included
 * the difyChatbotConfig should contain the token of the chatbot
 * the token can be found in the chatbot settings page
 */

// attention: This JavaScript script must be placed after the <body> element. Otherwise, the script will not work.

(function () {
  // Constants for DOM element IDs and configuration key
  const configKey = "difyChatbotConfig";
  const buttonId = "dify-chatbot-bubble-button";
  const iframeId = "dify-chatbot-bubble-window";
  const config = window[configKey];
  let isExpanded = false;

  // SVG icons for open and close states
  const svgIcons = `<svg id="openIcon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7.7586 2L16.2412 2C17.0462 1.99999 17.7105 1.99998 18.2517 2.04419C18.8138 2.09012 19.3305 2.18868 19.8159 2.43598C20.5685 2.81947 21.1804 3.43139 21.5639 4.18404C21.8112 4.66937 21.9098 5.18608 21.9557 5.74818C21.9999 6.28937 21.9999 6.95373 21.9999 7.7587L22 14.1376C22.0004 14.933 22.0007 15.5236 21.8636 16.0353C21.4937 17.4156 20.4155 18.4938 19.0352 18.8637C18.7277 18.9461 18.3917 18.9789 17.9999 18.9918L17.9999 20.371C18 20.6062 18 20.846 17.9822 21.0425C17.9651 21.2305 17.9199 21.5852 17.6722 21.8955C17.3872 22.2525 16.9551 22.4602 16.4983 22.4597C16.1013 22.4593 15.7961 22.273 15.6386 22.1689C15.474 22.06 15.2868 21.9102 15.1031 21.7632L12.69 19.8327C12.1714 19.4178 12.0174 19.3007 11.8575 19.219C11.697 19.137 11.5262 19.0771 11.3496 19.0408C11.1737 19.0047 10.9803 19 10.3162 19H7.75858C6.95362 19 6.28927 19 5.74808 18.9558C5.18598 18.9099 4.66928 18.8113 4.18394 18.564C3.43129 18.1805 2.81937 17.5686 2.43588 16.816C2.18859 16.3306 2.09002 15.8139 2.0441 15.2518C1.99988 14.7106 1.99989 14.0463 1.9999 13.2413V7.75868C1.99989 6.95372 1.99988 6.28936 2.0441 5.74818C2.09002 5.18608 2.18859 4.66937 2.43588 4.18404C2.81937 3.43139 3.43129 2.81947 4.18394 2.43598C4.66928 2.18868 5.18598 2.09012 5.74808 2.04419C6.28927 1.99998 6.95364 1.99999 7.7586 2ZM10.5073 7.5C10.5073 6.67157 9.83575 6 9.00732 6C8.1789 6 7.50732 6.67157 7.50732 7.5C7.50732 8.32843 8.1789 9 9.00732 9C9.83575 9 10.5073 8.32843 10.5073 7.5ZM16.6073 11.7001C16.1669 11.3697 15.5426 11.4577 15.2105 11.8959C15.1488 11.9746 15.081 12.0486 15.0119 12.1207C14.8646 12.2744 14.6432 12.4829 14.3566 12.6913C13.7796 13.111 12.9818 13.5001 12.0073 13.5001C11.0328 13.5001 10.235 13.111 9.65799 12.6913C9.37138 12.4829 9.15004 12.2744 9.00274 12.1207C8.93366 12.0486 8.86581 11.9745 8.80418 11.8959C8.472 11.4577 7.84775 11.3697 7.40732 11.7001C6.96549 12.0314 6.87595 12.6582 7.20732 13.1001C7.20479 13.0968 7.21072 13.1043 7.22094 13.1171C7.24532 13.1478 7.29407 13.2091 7.31068 13.2289C7.36932 13.2987 7.45232 13.3934 7.55877 13.5045C7.77084 13.7258 8.08075 14.0172 8.48165 14.3088C9.27958 14.8891 10.4818 15.5001 12.0073 15.5001C13.5328 15.5001 14.735 14.8891 15.533 14.3088C15.9339 14.0172 16.2438 13.7258 16.4559 13.5045C16.5623 13.3934 16.6453 13.2987 16.704 13.2289C16.7333 13.1939 16.7567 13.165 16.7739 13.1432C17.1193 12.6969 17.0729 12.0493 16.6073 11.7001ZM15.0073 6C15.8358 6 16.5073 6.67157 16.5073 7.5C16.5073 8.32843 15.8358 9 15.0073 9C14.1789 9 13.5073 8.32843 13.5073 7.5C13.5073 6.67157 14.1789 6 15.0073 6Z" fill="white"/>
    </svg>
    <svg id="closeIcon" style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 18L6 6M6 18L18 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    `;


  const originalIframeStyleText = `
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    top: unset;
    right: var(--${buttonId}-right, 1rem); /* Align with dify-chatbot-bubble-button. */
    bottom: var(--${buttonId}-bottom, 1rem); /* Align with dify-chatbot-bubble-button. */
    left: unset;
    width: 24rem;
    max-width: calc(100vw - 2rem);
    height: 43.75rem;
    max-height: calc(100vh - 6rem);
    border: none;
    border-radius: 1rem;
    z-index: 2147483640;
    overflow: hidden;
    user-select: none;
    transition-property: width, height;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
  `

  const expandedIframeStyleText = `
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    top: unset;
    right: var(--${buttonId}-right, 1rem); /* Align with dify-chatbot-bubble-button. */
    bottom: var(--${buttonId}-bottom, 1rem); /* Align with dify-chatbot-bubble-button. */
    left: unset;
    min-width: 24rem;
    width: 48%;
    max-width: 40rem; /* Match mobile breakpoint*/
    min-height: 43.75rem;
    height: 88%;
    max-height: calc(100vh - 6rem);
    border: none;
    border-radius: 1rem;
    z-index: 2147483640;
    overflow: hidden;
    user-select: none;
    transition-property: width, height;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
  `

  // Main function to embed the chatbot
  async function embedChatbot() {
    let isDragging = false

    if (!config || !config.token) {
      console.error(`${configKey} is empty or token is not provided`);
      return;
    }

    async function compressAndEncodeBase64(input) {
      const uint8Array = new TextEncoder().encode(input);
      const compressedStream = new Response(
        new Blob([uint8Array])
          .stream()
          .pipeThrough(new CompressionStream("gzip"))
      ).arrayBuffer();
      const compressedUint8Array = new Uint8Array(await compressedStream);
      return btoa(String.fromCharCode(...compressedUint8Array));
    }

    async function getCompressedInputsFromConfig() {
      const inputs = config?.inputs || {};
      const compressedInputs = {};
      await Promise.all(
        Object.entries(inputs).map(async ([key, value]) => {
          compressedInputs[key] = await compressAndEncodeBase64(value);
        })
      );
      return compressedInputs;
    }

    async function getCompressedSystemVariablesFromConfig() {
      const systemVariables = config?.systemVariables || {};
      const compressedSystemVariables = {};
      await Promise.all(
        Object.entries(systemVariables).map(async ([key, value]) => {
          compressedSystemVariables[`sys.${key}`] = await compressAndEncodeBase64(value);
        })
      );
      return compressedSystemVariables;
    }

    async function getCompressedUserVariablesFromConfig() {
      const userVariables = config?.userVariables || {};
      const compressedUserVariables = {};
      await Promise.all(
        Object.entries(userVariables).map(async ([key, value]) => {
          compressedUserVariables[`user.${key}`] = await compressAndEncodeBase64(value);
        })
      );
      return compressedUserVariables;
    }

    const params = new URLSearchParams({
      ...await getCompressedInputsFromConfig(),
      ...await getCompressedSystemVariablesFromConfig(),
      ...await getCompressedUserVariablesFromConfig()
    });

    const baseUrl =
      config.baseUrl || `https://${config.isDev ? "dev." : ""}udify.app`;
    const targetOrigin = new URL(baseUrl).origin;

    // pre-check the length of the URL
    const iframeUrl = `${baseUrl}/chatbot/${config.token}?${params}`;
    // 1) CREATE the iframe immediately, so it can load in the background:
    const preloadedIframe = createIframe();
    // 2) HIDE it by default:
    preloadedIframe.style.display = "none";
    // 3) APPEND it to the document body right away:
    document.body.appendChild(preloadedIframe);
    // ─── End Fix Snippet
    if (iframeUrl.length > 2048) {
      console.error("The URL is too long, please reduce the number of inputs to prevent the bot from failing to load");
    }

    // Function to create the iframe for the chatbot
    function createIframe() {
      const iframe = document.createElement("iframe");
      iframe.allow = "fullscreen;microphone";
      iframe.title = "dify chatbot bubble window";
      iframe.id = iframeId;
      iframe.src = iframeUrl;
      iframe.style.cssText = originalIframeStyleText;

      return iframe;
    }

    // Function to reset the iframe position
    function resetIframePosition() {
      if (window.innerWidth <= 640) return;

      const targetIframe = document.getElementById(iframeId);
      const targetButton = document.getElementById(buttonId);
      if (targetIframe && targetButton) {
        const buttonRect = targetButton.getBoundingClientRect();
        // We don't necessarily need iframeRect anymore with the center logic

        const viewportCenterY = window.innerHeight / 2;
        const buttonCenterY = buttonRect.top + buttonRect.height / 2;

        if (buttonCenterY < viewportCenterY) {
          targetIframe.style.top = `var(--${buttonId}-bottom, 1rem)`;
          targetIframe.style.bottom = 'unset';
        } else {
          targetIframe.style.bottom = `var(--${buttonId}-bottom, 1rem)`;
          targetIframe.style.top = 'unset';
        }

        const viewportCenterX = window.innerWidth / 2;
        const buttonCenterX = buttonRect.left + buttonRect.width / 2;

        if (buttonCenterX < viewportCenterX) {
          targetIframe.style.left = `var(--${buttonId}-right, 1rem)`;
          targetIframe.style.right = 'unset';
        } else {
          targetIframe.style.right = `var(--${buttonId}-right, 1rem)`;
          targetIframe.style.left = 'unset';
        }
      }
    }

    function toggleExpand() {
      isExpanded = !isExpanded;

      const targetIframe = document.getElementById(iframeId);
      if (!targetIframe) return;

      if (isExpanded) {
        targetIframe.style.cssText = expandedIframeStyleText;
      } else {
        targetIframe.style.cssText = originalIframeStyleText;
      }
      resetIframePosition();
    }

    window.addEventListener('message', (event) => {
      if (event.origin !== targetOrigin) return;

      const targetIframe = document.getElementById(iframeId);
      if (!targetIframe || event.source !== targetIframe.contentWindow) return;

      if (event.data.type === 'dify-chatbot-iframe-ready') {
        targetIframe.contentWindow?.postMessage(
          {
            type: 'dify-chatbot-config',
            payload: {
              isToggledByButton: true,
              isDraggable: !!config.draggable,
            },
          },
          targetOrigin
        );
      }

      if (event.data.type === 'dify-chatbot-expand-change') {
        toggleExpand();
      }
    });

    // Function to create the chat button
    function createButton() {
      const containerDiv = document.createElement("div");
      // Apply custom properties from config
      Object.entries(config.containerProps || {}).forEach(([key, value]) => {
        if (key === "className") {
          containerDiv.classList.add(...value.split(" "));
        } else if (key === "style") {
          if (typeof value === "object") {
            Object.assign(containerDiv.style, value);
          } else {
            containerDiv.style.cssText = value;
          }
        } else if (typeof value === "function") {
          containerDiv.addEventListener(
            key.replace(/^on/, "").toLowerCase(),
            value
          );
        } else {
          containerDiv[key] = value;
        }
      });

      containerDiv.id = buttonId;

      // Add styles for the button
      const styleSheet = document.createElement("style");
      document.head.appendChild(styleSheet);
      styleSheet.sheet.insertRule(`
        #${containerDiv.id} {
          position: fixed;
          bottom: var(--${containerDiv.id}-bottom, 1rem);
          right: var(--${containerDiv.id}-right, 1rem);
          left: var(--${containerDiv.id}-left, unset);
          top: var(--${containerDiv.id}-top, unset);
          width: var(--${containerDiv.id}-width, 48px);
          height: var(--${containerDiv.id}-height, 48px);
          border-radius: var(--${containerDiv.id}-border-radius, 25px);
          background-color: var(--${containerDiv.id}-bg-color, #155EEF);
          box-shadow: var(--${containerDiv.id}-box-shadow, rgba(0, 0, 0, 0.2) 0px 4px 8px 0px);
          cursor: pointer;
          z-index: 2147483647;
        }
      `);

      // Create display div for the button icon
      const displayDiv = document.createElement("div");
      displayDiv.style.cssText =
        "position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; z-index: 2147483647;";
      displayDiv.innerHTML = svgIcons;
      containerDiv.appendChild(displayDiv);
      document.body.appendChild(containerDiv);

      // Add click event listener to toggle chatbot
      containerDiv.addEventListener("click", handleClick);
      // Add touch event listener
      containerDiv.addEventListener("touchend", (event) => {
        event.preventDefault();
        handleClick();
      }, { passive: false });

      function handleClick() {
        if (isDragging) return;

        const targetIframe = document.getElementById(iframeId);
        if (!targetIframe) {
          containerDiv.appendChild(createIframe());
          resetIframePosition();
          this.title = "Exit (ESC)";
          setSvgIcon("close");
          document.addEventListener("keydown", handleEscKey);
          return;
        }
        targetIframe.style.display =
          targetIframe.style.display === "none" ? "block" : "none";
        targetIframe.style.display === "none"
          ? setSvgIcon("open")
          : setSvgIcon("close");

        if (targetIframe.style.display === "none") {
          document.removeEventListener("keydown", handleEscKey);
        } else {
          document.addEventListener("keydown", handleEscKey);
        }

        resetIframePosition();
      }

      // Enable dragging if specified in config
      if (config.draggable) {
        enableDragging(containerDiv, config.dragAxis || "both");
      }
    }

    // Function to enable dragging of the chat button
    function enableDragging(element, axis) {
      let startX, startY, startClientX, startClientY;

      element.addEventListener("mousedown", startDragging);
      element.addEventListener("touchstart", startDragging);

      function startDragging(e) {
        isDragging = false;
        if (e.type === "touchstart") {
          startX = e.touches[0].clientX - element.offsetLeft;
          startY = e.touches[0].clientY - element.offsetTop;
          startClientX = e.touches[0].clientX;
          startClientY = e.touches[0].clientY;
        } else {
          startX = e.clientX - element.offsetLeft;
          startY = e.clientY - element.offsetTop;
          startClientX = e.clientX;
          startClientY = e.clientY;
        }
        document.addEventListener("mousemove", drag);
        document.addEventListener("touchmove", drag, { passive: false });
        document.addEventListener("mouseup", stopDragging);
        document.addEventListener("touchend", stopDragging);
        e.preventDefault();
      }

      function drag(e) {
        const touch = e.type === "touchmove" ? e.touches[0] : e;
        const deltaX = touch.clientX - startClientX;
        const deltaY = touch.clientY - startClientY;

        // Determine whether it is a drag operation
        if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
          isDragging = true;
        }

        if (!isDragging) return;

        element.style.transition = "none";
        element.style.cursor = "grabbing";

        // Hide iframe while dragging
        const targetIframe = document.getElementById(iframeId);
        if (targetIframe) {
          targetIframe.style.display = "none";
          setSvgIcon("open");
        }

        let newLeft, newBottom;
        if (e.type === "touchmove") {
          newLeft = e.touches[0].clientX - startX;
          newBottom = window.innerHeight - e.touches[0].clientY - startY;
        } else {
          newLeft = e.clientX - startX;
          newBottom = window.innerHeight - e.clientY - startY;
        }

        const elementRect = element.getBoundingClientRect();
        const maxX = window.innerWidth - elementRect.width;
        const maxY = window.innerHeight - elementRect.height;

        // Update position based on drag axis
        if (axis === "x" || axis === "both") {
          element.style.setProperty(
            `--${buttonId}-left`,
            `${Math.max(0, Math.min(newLeft, maxX))}px`
          );
        }

        if (axis === "y" || axis === "both") {
          element.style.setProperty(
            `--${buttonId}-bottom`,
            `${Math.max(0, Math.min(newBottom, maxY))}px`
          );
        }
      }

      function stopDragging() {
        setTimeout(() => {
          isDragging = false;
        }, 0);
        element.style.transition = "";
        element.style.cursor = "pointer";

        document.removeEventListener("mousemove", drag);
        document.removeEventListener("touchmove", drag);
        document.removeEventListener("mouseup", stopDragging);
        document.removeEventListener("touchend", stopDragging);
      }
    }

    // Create the chat button if it doesn't exist
    if (!document.getElementById(buttonId)) {
      createButton();
    }
  }

  function setSvgIcon(type = "open") {
    if (type === "open") {
      document.getElementById("openIcon").style.display = "block";
      document.getElementById("closeIcon").style.display = "none";
    } else {
      document.getElementById("openIcon").style.display = "none";
      document.getElementById("closeIcon").style.display = "block";
    }
  }

  // Add esc Exit keyboard event triggered
  function handleEscKey(event) {
    if (event.key === "Escape") {
      const targetIframe = document.getElementById(iframeId);
      if (targetIframe && targetIframe.style.display !== "none") {
        targetIframe.style.display = "none";
        setSvgIcon("open");
      }
    }
  }
  document.addEventListener("keydown", handleEscKey);

  // Set the embedChatbot function to run when the body is loaded,Avoid infinite nesting
  if (config?.dynamicScript) {
    embedChatbot();
  } else {
    document.body.onload = embedChatbot;
  }
})();
