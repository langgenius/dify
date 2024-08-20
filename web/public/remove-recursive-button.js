
function handleChatbotClick() {
  const bubbleButton = document.getElementById('dify-chatbot-bubble-button');
  if (bubbleButton) {
    bubbleButton.addEventListener('click', function() {
      const iframe = document.getElementById('dify-chatbot-bubble-window');
      if (iframe && iframe.contentDocument) {
        const divInIframe = iframe.contentDocument.getElementById('dify-chatbot-bubble-button');
        if (divInIframe) {
          divInIframe.remove();
        }
      }
    });
  }
}

// Run the function when the DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleChatbotClick);
} else {
  handleChatbotClick();
}