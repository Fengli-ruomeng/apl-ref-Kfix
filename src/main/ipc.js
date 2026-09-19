const { ipcMain } = require('electron')
const { WebSocket } = require('ws')
const { CMDS_SET } = require('../referee/commands')
const { EVENTS } = require('../referee/events')
const { version } = require('../../package.json')
const { getLogger } = require("@logtape/logtape")
const { fetchJson } = require('./http')
const IS_PROD = process.env.DEV_SERVER == null
const  OSU_SERVER = IS_PROD ? "osu.ppy.sh" : "dev.ppy.sh"

function createHandler(getRefereeClient, handlerFn) {
    return async (event, ...args) => {
        const refereeClient = getRefereeClient()
        if (!refereeClient) {
            return { success: false, error: 'Client not initialized' }
        }
        try {
            const result = await handlerFn(refereeClient, ...args)
            return { success: true, data: result }
        } catch (err) {
            return { success: false, error: err.message }
        }
    }
}

function genericHandler(getRefereeClient, cmd) {
    return async (event, ...args) => {
        const refereeClient = getRefereeClient();
        if (!refereeClient) {
            return { success: false, error: 'Client not initialized' }
        }
        try {
            const result = await refereeClient[cmd](...args)
            return { success: true, data: result }
        } catch (err) {
            console.log(err, "oh")
            console.log(cmd);
            console.log(...args)
            //console.log(refereeClient)
            return { success: false, error: err.message }
        }

    }
}

function createQueryHandler(getRefereeClient, queryFn) {
    return async (event, ...args) => {
        const refereeClient = getRefereeClient()
        try {
            return { success: true, data: await queryFn(refereeClient, ...args) }
        } catch (err) {
            return { success: false, error: err.message }
        }
    }
}

function setupIpcHandlers(getRefereeClient) {
    ipcMain.handle('ResyncRoom', createHandler(getRefereeClient, (client, roomId) => client.resyncRoom(roomId)))
    ipcMain.handle('get-api-data', async () => {
        return [CMDS_SET, EVENTS, version]
    })
    CMDS_SET.forEach(cmd => {
        ipcMain.handle(cmd, genericHandler(getRefereeClient, cmd));
    })
    ipcMain.handle('Log', createQueryHandler(getRefereeClient, (client, type, text) => {
        const logger = getLogger(["apl-ref", "web"]);
        return logger[type]("{text}", {text})
    }))
    ipcMain.handle('GetUser', createQueryHandler(getRefereeClient, async (client, user_id) => {
        const accessToken = await client.getAccessToken();
        const url = new URL(`https://${OSU_SERVER}/api/v2/users/${user_id}/osu`);
        //url.searchParams.append("key", "at")
        // ^ technically we want either or so...
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            Authorization: `Bearer ${accessToken}`,
        }

        const x = fetchJson(url, {
            method: "GET",
            headers,
        })
        //console.log(x)
        return x;
    }))
    ipcMain.handle('GetSelf', createQueryHandler(getRefereeClient, async (client) => {
        const accessToken = await client.getAccessToken();
        const url = new URL(`https://${OSU_SERVER}/api/v2/me`);
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            Authorization: `Bearer ${accessToken}`,
        }

        const x = fetchJson(url, {
            method: "GET",
            headers,
        })
        //console.log(x)
        return x;
    }))
    ipcMain.handle('SendMessage', createQueryHandler(getRefereeClient, async (client, channel_id, message) => {
        const accessToken = await client.getAccessToken();
        const url = new URL(`https://${OSU_SERVER}/api/v2/chat/channels/${channel_id}/messages`);
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            Authorization: `Bearer ${accessToken}`,
        }
        
        const body = {
            "message": message,
            "is_action": false
        };
        return fetchJson(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    }))
    ipcMain.handle('GetBeatmap', createQueryHandler(getRefereeClient, async (client, beatmap_id) => {
        const accessToken = await client.getAccessToken();
        const url = new URL(`https://${OSU_SERVER}/api/v2/beatmaps/${beatmap_id}`);
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            Authorization: `Bearer ${accessToken}`,
        }
        
        return fetchJson(url, {
            method: "GET",
            headers,
        });
    }))
    ipcMain.handle('GetScores', createQueryHandler(getRefereeClient, async (client, room_id, playlist_id) => {
        const accessToken = await client.getAccessToken();
        const url = new URL(`https://${OSU_SERVER}/api/v2/rooms/${room_id}/playlist/${playlist_id}/scores`);
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            Authorization: `Bearer ${accessToken}`,
        }
        
        return fetchJson(url, {
            method: "GET",
            headers,
        });
    }))

    ipcMain.handle('CloseWS', createQueryHandler(getRefereeClient, (client) => {
        return client.ws_close();
    }))

    ipcMain.handle('GetConnectionStatus', createQueryHandler(getRefereeClient, (client) => {
        return { connected: client?.connected || false }
    }))

}

function setupWSEvents(tokenProvider, sendFunc) {
    const logger  = getLogger (["apl-ref", "WS"]);
    const url = IS_PROD ? "wss://notify.ppy.sh" : "wss://dev.ppy.sh/home/notifications/feed"
    let ws;
    let reconnectTimer = null
    let attempts = 0;
    let stopped = false
    function reconnect() {
        if (stopped) return
        const delay = Math.min(1000 * (2 ** attempts++), 16_000)
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(connect, delay)
    }
    async function connect() {
        try {
        const accessToken = typeof tokenProvider === 'function' ? await tokenProvider() : tokenProvider
        if (stopped) return
        const headers = { Authorization: `Bearer ${accessToken}` }
        ws = new WebSocket(url, [], { headers });
        ws.on('open', () => {
            ws.send(JSON.stringify({ event: 'chat.start' }));
            logger.info("Opened!")
            attempts = 0
        })
        ws.on('message', (buffer) => {
            //console.log(buffer.toString())
            sendFunc('chat-event', buffer.toString())
        });
        ws.on('close', reconnect)
        ws.on('error', (ev) => {
            logger.error('Chat connection error: {message}', { message: ev.message })
            ws.close() // i assume i need this??
        })
        } catch (error) { logger.error('Chat connection failed: {message}', { message: error.message }); reconnect() }
    }
    connect()
    return () => {
        stopped = true
        clearTimeout(reconnectTimer)
        ws?.close()
    }
}

module.exports = { setupIpcHandlers, createHandler, createQueryHandler, setupWSEvents }
