// Shared auth module for dashboard frontend
function getApiKey() {
  let key = localStorage.getItem('api_key');
  if (!key) {
    key = prompt('Enter API key (from .env):');
    if (key) localStorage.setItem('api_key', key);
  }
  return key;
}

function authHeaders() {
  const key = getApiKey();
  return key ? { 'Authorization': `Bearer ${key}` } : {};
}

async function authFetch(url, opts = {}) {
  opts.headers = { ...opts.headers, ...authHeaders() };
  const res = await fetch(url, opts);
  if (res.status === 401) {
    localStorage.removeItem('api_key');
    alert('Invalid API key — please re-enter');
    location.reload();
    throw new Error('Unauthorized');
  }
  return res;
}
