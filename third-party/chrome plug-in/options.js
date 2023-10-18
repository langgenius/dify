document.getElementById('save-button').addEventListener('click', function() {
  var baseUrl = document.getElementById('base-url').value;
  var token = document.getElementById('token').value;
  
  if (baseUrl === '' || token === '') {
    alert('Dify Chatbot Extension Options Not filled.');
    return;
  }
  
  chrome.storage.sync.set({
    'baseUrl': baseUrl,
    'token': token
  }, function() {
    alert('Save Success!');
  });
});

// Load parameters from chrome.storage when the page loads
chrome.storage.sync.get(['baseUrl', 'token'], function(result) {
  const baseUrlInput = document.getElementById('base-url');
  const tokenInput = document.getElementById('token');

  if (result.baseUrl) {
    baseUrlInput.value = result.baseUrl;
  } else {
    baseUrlInput.placeholder = 'Dify Domain Url';
  }

  if (result.token) {
    tokenInput.value = result.token;
  } else {
    tokenInput.placeholder = 'Application Embedded Token';
  }
});