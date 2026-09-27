const { Worker } = require('node:worker_threads');
const path = require('node:path');
// One bounded job at a time. Cancel terminates parsing as well as matching;
// a new query never sits behind an obsolete 10 MB Markdown parse.
module.exports = function searchService() {
  let worker, pending;
  function cancel() {
    const old = worker; worker = null;
    if (pending) { pending.resolve(null); pending = null; }
    if (old) void old.terminate();
  }
  function search(request) {
    if (pending) cancel();
    if (!worker) {
      const current = worker = new Worker(path.join(__dirname, 'content-search-worker.cjs'), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
      current.on('message', message => {
        if (worker !== current || !pending) return;
        const job = pending; pending = null;
        if (message.error) job.reject(Error('Search failed')); else job.resolve(message.result);
      });
      current.on('error', error => {
        if (worker !== current) return;
        worker = null;
        if (pending) { pending.reject(error); pending = null; }
      });
    }
    return new Promise((resolve, reject) => { pending = { resolve, reject }; worker.postMessage(request); });
  }
  return { search, cancel };
};
