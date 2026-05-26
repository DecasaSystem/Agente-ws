async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  }
}

async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 10000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      if (i === retries) throw error;
      console.log(`Retry ${i + 1}/${retries} for ${url}: ${error.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

module.exports = { fetchWithTimeout, fetchWithRetry };
