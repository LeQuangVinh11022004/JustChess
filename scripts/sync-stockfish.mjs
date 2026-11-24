import fs from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve('node_modules/stockfish/bin')
const dstDir = path.resolve('public/stockfish')
fs.mkdirSync(dstDir, { recursive: true })

const files = [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
  'stockfish-19-single.js',
  'stockfish-19-single.wasm',
]

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file))
}

// Patch upstream stockfish@19.0.1 minifier bug in stockfish-19-single.js:
// 1. `.catch(function t(r){e.error(r),t(r)})` causes infinite recursion (RangeError: Maximum call stack size exceeded)
//    whenever the manual ReadableStream wrapper errors or hits backpressure on the 94.5MB WASM stream.
// 2. Replace the manual ReadableStream pump with a Cache-Storage-first direct Response so
//    WebAssembly.instantiateStreaming reads directly from `justchess-sf19-full-v1` cache (or fetch) cleanly.
const fullJsPath = path.join(dstDir, 'stockfish-19-single.js')
const original = fs.readFileSync(fullJsPath, 'utf8')

const buggyBlock =
  'return fetch(e).then(function(e){var r=Date.now();if(!e.ok)throw new Error("HTTP "+e.status+": "+e.statusText);var n=99169054,a=0,o=e.body.getReader(),i=new ReadableStream({start:function(e){!function i(){o.read().then(function(o){var s=o.done,f=o.value;if(s)return t(r,n,n),void e.close();a+=f.byteLength,t(r,a,n),e.enqueue(f),i()}).catch(function t(r){e.error(r),t(r)})}()}}),s=new Headers(e.headers);return new Response(i,{status:e.status,statusText:e.statusText,headers:s})})'

const fixedBlock =
  'return (typeof caches!=="undefined"?caches.open("justchess-sf19-full-v1").then(function(c){return c.match(e)}).catch(function(){return null}):Promise.resolve(null)).then(function(h){if(h)return h;return fetch(e).then(function(res){if(!res.ok)throw new Error("HTTP "+res.status+": "+res.statusText);return res})})'

if (original.includes(buggyBlock)) {
  fs.writeFileSync(fullJsPath, original.replace(buggyBlock, fixedBlock), 'utf8')
  console.log('Patched stockfish-19-single.js (Cache-first + fixed ReadableStream crash).')
} else {
  console.warn('Warning: expected block not found in stockfish-19-single.js; skipping patch.')
}
