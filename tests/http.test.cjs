const test = require('node:test')
const assert = require('node:assert/strict')
const { fetchJson } = require('../src/main/http')

test('HTTP 403 JSON errors are failures instead of successful IPC payloads', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ error:'Cannot send to this channel' }), {status:403}))
    await assert.rejects(fetchJson('https://example.invalid'), /HTTP 403: Cannot send/)
})
test('HTTP 401 includes actionable sign-in guidance', async t => {
    t.mock.method(global, 'fetch', async () => new Response('', {status:401}))
    await assert.rejects(fetchJson('https://example.invalid'), /sign in again/)
})
test('successful message response keeps its ID for websocket deduplication', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ message_id:123, content:'hello' }), {status:200}))
    assert.equal((await fetchJson('https://example.invalid')).message_id,123)
})
test('non-JSON proxy errors do not leak HTML into the UI', async t => {
    t.mock.method(global, 'fetch', async () => new Response('<html>upstream error</html>', {status:502,statusText:'Bad Gateway'}))
    await assert.rejects(fetchJson('https://example.invalid'), /HTTP 502: Bad Gateway/)
})
