// A JSON error response is still a failed request, even when fetch() resolves.
async function fetchJson(url, options) {
    const response = await fetch(url, options)
    const text = await response.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch {
        throw new Error(`HTTP ${response.status}: ${response.ok ? 'Invalid JSON response' : (response.statusText || 'Request failed')}`)
    }
    if (!response.ok || data?.error) {
        const detail = typeof data?.error === 'string' ? data.error : data?.message || response.statusText || 'Request failed'
        throw new Error(`HTTP ${response.status}: ${detail}${response.status === 401 ? ' — please sign in again' : ''}`)
    }
    return data
}
module.exports = { fetchJson }
