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

// 在页面加载时从chrome.storage中加载参数
chrome.storage.sync.get(['baseUrl', 'token'], function(result) {
  document.getElementById('base-url').value = result.baseUrl;
  document.getElementById('token').value = result.token;
});