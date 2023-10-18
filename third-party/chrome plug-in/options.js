
document.getElementById('save-button').addEventListener('click', function (e) {
  e.preventDefault();
  var baseUrl = document.getElementById('base-url').value;
  var token = document.getElementById('token').value;
  var errorTip = document.getElementById('error-tip');

  if (baseUrl.trim() === "" || token.trim() === "") {
    if (baseUrl.trim() === "") {
      errorTip.textContent = "Base URL cannot be empty.";
    } else {
      errorTip.textContent = "Token cannot be empty.";
    }
  } else {
    errorTip.textContent = "";

    chrome.storage.sync.set({
      'baseUrl': baseUrl,
      'token': token
    }, function () {
      alert('Save Success!');
    });
  }

});

// Load parameters from chrome.storage when the page loads
chrome.storage.sync.get(['baseUrl', 'token'], function (result) {
  const baseUrlInput = document.getElementById('base-url');
  const tokenInput = document.getElementById('token');

  if (result.baseUrl) {
    baseUrlInput.value = result.baseUrl;
  }

  if (result.token) {
    tokenInput.value = result.token;
  }
});