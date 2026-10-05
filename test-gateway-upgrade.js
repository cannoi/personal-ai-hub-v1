import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { mountOpenAICompat } from './openai-compat.js';

function createMiniApp() {
  const routes = [];
  const m = method => (p, ...h) => routes.push({ method, path: p, handlers: h });
  return { get: m('GET'), post: m('POST'), put: m('PUT'), patch: m('PATCH'), delete: m('DELETE'), use() {}, _routes: routes };
}
function runHandlers(handlers, req, res) {
  let i = 0;
  const next = err => { if (err) { res.statusCode = 500; return res.end(JSON.stringify({ error: String(err) })); } const h = handlers[i++]; if (!h) return; try { Promise.resolve(h(req, res, next)).catch(next); } catch (e) { next(e); } };
  next();
}
async function start(kernel) {
  const app = createMiniApp(); mountOpenAICompat(app, { kernel, serviceName: 'personal-ai-hub' });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1'); let body = '';
    req.on('data', c => { body += c; }); req.on('end', () => {
      let json = {}; try { if (body) json = JSON.parse(body); } catch {}
      const route = app._routes.find(r => r.method === req.method && r.path === url.pathname);
      if (!route) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'NOT_FOUND' })); }
      const fakeReq = { method: req.method, path: url.pathname, url: req.url, headers: req.headers, body: json, query: Object.fromEntries(url.searchParams), ip: '127.0.0.1', get(n) { return n.toLowerCase() === 'host' ? req.headers.host : req.headers[n.toLowerCase()]; } };
      const fakeRes = { statusCode: 200, headers: {}, status(c) { this.statusCode = c; return this; }, setHeader(k,v){this.headers[k]=v;}, json(o){res.statusCode=this.statusCode; for(const[k,v]of Object.entries(this.headers))res.setHeader(k,v); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(o));}, write(s){if(!this._chunks)this._chunks=[];this._chunks.push(String(s));}, end(s){res.statusCode=this.statusCode; for(const[k,v]of Object.entries(this.headers))res.setHeader(k,v); if(this._chunks?.length)res.end(this._chunks.join('')+(s||''));else res.end(s);} };
      runHandlers(route.handlers, fakeReq, fakeRes);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); return { server, port: server.address().port };
}
async function call(port, method, p, body, headers={}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type':'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json=JSON.parse(text); } catch { json=text; } return { status:r.status, headers:r.headers, json, text };
}
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pah-upgrade-'));
const store = { async list(){return[]}, async put(){} };
const actions = { async invoke(){return{ok:true}}, list(){return[]} };
const fetchImpl = async (url, init={}) => {
  const u=String(url);
  if(u.includes('/api/tags')) return new Response(JSON.stringify({models:[{name:'qwen2.5-coder:1.5b'}]}),{status:200});
  if(u.includes('/api/chat')) return new Response(JSON.stringify({message:{content:'local'},model:'qwen2.5-coder:1.5b',prompt_eval_count:5,eval_count:7}),{status:200});
  if(u.includes('/models')) return new Response(JSON.stringify({data:[{id:'gpt-test'}]}),{status:200});
  if(u.includes('/embeddings')) return new Response(JSON.stringify({data:[{embedding:[0.1,0.2],index:0}],usage:{prompt_tokens:3,total_tokens:3}}),{status:200});
  if(u.includes('/chat/completions')) return new Response(JSON.stringify({choices:[{message:{content:'cloud'}}],model:'gpt-test',usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}),{status:200});
  return new Response('{}',{status:404});
};
const kernel=createAiKernel({store,actions,fetchImpl,vaultFile:path.join(tmp,'v.json'),logFile:path.join(tmp,'l.json'),stateFile:path.join(tmp,'s.json'),providers:{openai:{id:'openai',name:'OpenAI',type:'openai-compatible',baseUrl:'https://example.test/v1',models:['gpt-test']},local:{id:'local',name:'Local',type:'ollama',baseUrl:'http://127.0.0.1:11434',models:[]}}});
await kernel.keys.addKey({provider:'local',token:''});
await kernel.keys.addKey({provider:'openai',token:'sk-test-abcdefghijklmnop'});
const tok=await kernel.gateway.createToken({name:'builder',type:'app'});
const {server,port}=await start(kernel);

const routes = ['POST /v1/responses','POST /v1/embeddings'];
for (const spec of routes) { const [method,p]=spec.split(' '); const route = method+' '+p; assert.ok(route); }
assert.equal((await call(port,'GET','/v1/models')).status,401);
assert.equal((await call(port,'GET','/v1/models',null,{Authorization:`Bearer ${tok.token}`})).status,200);
assert.equal((await call(port,'GET','/v1/models?api_key='+encodeURIComponent(tok.token))).status,401,'query API key must be rejected');
const chat=await call(port,'POST','/v1/chat/completions',{model:'auto',messages:[{role:'user',content:'hi'}]},{Authorization:`Bearer ${tok.token}`,'X-SoloHost-App-ID':'builder'});
assert.equal(chat.status,200,JSON.stringify(chat.json)); assert.ok(chat.json.usage.total_tokens > 0); assert.ok(chat.json.id); assert.ok(chat.json.personal_ai_hub.requestId);
const stream=await call(port,'POST','/v1/chat/completions',{model:'auto',stream:true,messages:[{role:'user',content:'hi'}]},{Authorization:`Bearer ${tok.token}`,'X-SoloHost-App-ID':'builder'});
assert.equal(stream.status,200); assert.match(stream.headers.get('content-type')||'',/text\/event-stream/); assert.match(stream.text,/data: \[DONE\]/);
const response=await call(port,'POST','/v1/responses',{model:'auto',input:'hello'},{Authorization:`Bearer ${tok.token}`,'X-SoloHost-App-ID':'builder'});
assert.equal(response.status,200); assert.equal(response.json.object,'response'); assert.ok(response.json.output?.length);
const emb=await call(port,'POST','/v1/embeddings',{model:'gpt-test',input:'hello'},{Authorization:`Bearer ${tok.token}`,'X-SoloHost-App-ID':'builder'});
assert.equal(emb.status,200,JSON.stringify(emb.json)); assert.equal(emb.json.object,'list'); assert.deepEqual(emb.json.data[0].embedding,[0.1,0.2]);
const usage=await kernel.gateway.usage({tokenId:tok.id}); assert.ok(usage.requests>=3); assert.ok(usage.totalTokens>=9);
assert.ok((await call(port,'GET','/v1/health',null,{Authorization:`Bearer ${tok.token}`})).json.gateway);
server.close();
console.log('GATEWAY UPGRADE TESTS PASSED');
