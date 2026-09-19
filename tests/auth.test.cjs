const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const jwt = seconds => 'header.' + Buffer.from(JSON.stringify({exp:Date.now()/1000+seconds})).toString('base64url') + '.signature'
function authFixture(token, refresh, config = {client_id:1,client_secret:'test-only'}) {
    const files = new Map()
    if(token) files.set('token.json',JSON.stringify(token))
    if(config) files.set('config.json',JSON.stringify(config))
    const module = {exports:{}}
    const fakeFs = {existsSync:p=>files.has(path.basename(p)),readFileSync:p=>files.get(path.basename(p)),writeFileSync:(p,text)=>files.set(path.basename(p),text)}
    const requireStub = name => name==='electron'?{app:{getPath:()=>'/test-only'},ipcMain:{}}:name==='fs'?fakeFs:name==='path'?path:name==='./main/http'?{fetchJson:refresh}:require(name)
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/auth.js'),'utf8'),{module,require:requireStub,console,Buffer,URL,URLSearchParams,setTimeout,Date,process:{env:{}}})
    return {auth:module.exports,files}
}

test('valid access tokens are reused without contacting OAuth',async()=>{
    let calls=0
    const token=jwt(3600)
    const {auth}=authFixture({access_token:token},async()=>{calls++})
    assert.equal(await auth.refreshAccessToken(),token)
    assert.equal(calls,0)
})
test('concurrent expired-token requests share one refresh and persist rotated credentials',async()=>{
    let calls=0,request
    const next=jwt(3600)
    const {auth,files}=authFixture({access_token:jwt(-10),refresh_token:'old-refresh'},async(url,options)=>{
        calls++;request=new URLSearchParams(options.body)
        await new Promise(r=>setTimeout(r,5))
        return {access_token:next,refresh_token:'new-refresh',expires_in:3600}
    })
    const results=await Promise.all([auth.refreshAccessToken(),auth.refreshAccessToken(),auth.refreshAccessToken()])
    assert.deepEqual(results,[next,next,next]);assert.equal(calls,1)
    assert.equal(request.get('grant_type'),'refresh_token')
    assert.equal(request.has('scope'),false)
    assert.equal(JSON.parse(files.get('token.json')).refresh_token,'new-refresh')
})
test('a failed refresh preserves the existing token file and gives actionable guidance',async()=>{
    const original={access_token:jwt(-10),refresh_token:'old-refresh'}
    const {auth,files}=authFixture(original,async()=>{throw Error('Invalid grant')})
    await assert.rejects(auth.refreshAccessToken(),/restart APL Ref to sign in/)
    assert.deepEqual(JSON.parse(files.get('token.json')),original)
})
test('saved client configuration is read even when no token file exists',()=>{
    const {auth}=authFixture(null,async()=>{})
    assert.equal(auth.readConfig().client_id,1)
})
