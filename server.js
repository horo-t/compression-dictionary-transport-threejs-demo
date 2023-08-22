
const crypto = require('crypto');
const fastify = require('fastify')({
  logger: false,
});
const path = require('path');
const fs = require('fs').promises;

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/', // optional: default '/'
});

async function loadThreeJsScript(ver) {
  const data = await fs.readFile(`third_party/three_js/${ver}.js`);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const compressed = await fs.readFile(`third_party/three_js/${ver}.js.br`);
  return {ver: ver, data: data, hash: hash, compressed: compressed};
}

async function loadThreeJsDelta(from, to) {
  const sbr = await fs.readFile(`third_party/three_js/${from}-${to}.js.sbr`);
  const szst = await fs.readFile(`third_party/three_js/${from}-${to}.js.szst`);
  return {from: from, to: to, sbr: sbr, szst: szst};
}


const THREE_JS_VERSIONS = ['151', '152', '153'];
async function loadThreeJsFiles() {
  let promises = [];
  THREE_JS_VERSIONS.forEach((ver) => {
    promises.push(loadThreeJsScript(ver));
  });
  const scripts = await Promise.all(promises);
  let scriptMap = {};
  let deltaMap = {};
  scripts.forEach((script) => {
    scriptMap[script.ver] = script;
    deltaMap[script.hash] = {};
  })

  promises = [];
  THREE_JS_VERSIONS.forEach((from) => {
    THREE_JS_VERSIONS.forEach((to) => {
      promises.push(loadThreeJsDelta(from, to));
    });
  });
  const delatas = await Promise.all(promises);
  delatas.forEach((delta) => {
    deltaMap[scriptMap[delta.from].hash][delta.to] = delta;
  });
  return {
    scriptMap: scriptMap,
    deltaMap: deltaMap
  }
}
const threeJsInfoPromise = loadThreeJsFiles();

THREE_JS_VERSIONS.forEach((ver) => {
  fastify.get(`/js/${ver}.js`, async function (request, reply) {
    reply.header('content-type', 'application/javascript; charset=utf-8');
    reply.header('cache-control', 'public, max-age=100');
    reply.header('use-as-dictionary', 'match="/js/*"');
    reply.header('vary', 'sec-available-dictionary');
    const threeJsInfo = await threeJsInfoPromise;
    const dictHash = request.headers['sec-available-dictionary'];
    const acceptEncodings = request.headers['accept-encoding'].split(',');
    const sbrSupported = acceptEncodings.some(x => x.trim()=='sbr');
    const szstSupported = acceptEncodings.some(x => x.trim()=='zstd-d');
    if (dictHash && 
        (sbrSupported || szstSupported) &&
        threeJsInfo.deltaMap[dictHash] &&
        threeJsInfo.deltaMap[dictHash][ver]) {
      if (szstSupported) {
        reply.header('content-encoding', 'zstd-d');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHash][ver].szst));
      } else {
        reply.header('content-encoding', 'sbr');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHash][ver].sbr));
      }
    } else if (threeJsInfo.scriptMap[ver]) {
      reply.header('content-encoding', 'br');
      reply.send(Buffer.from(threeJsInfo.scriptMap[ver].compressed));
    }
  });
});


fastify.listen(
  { port: process.env.PORT, host: '0.0.0.0' },
  function (err, address) {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
    fastify.log.info(`server listening on ${address}`);
  }
);
