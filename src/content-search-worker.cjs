const { parentPort } = require('node:worker_threads');
const { searchSource } = require('./content-search-core.cjs');
parentPort.on('message', request => {
  try { parentPort.postMessage({ result: searchSource(request.source, request.query, request.caseSensitive, request.limit) }); }
  catch { parentPort.postMessage({ error: true }); }
});
