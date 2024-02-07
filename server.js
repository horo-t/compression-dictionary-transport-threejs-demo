
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
  const hashV1 = crypto.createHash('sha256').update(data).digest('hex');
  const hashV2 = ':' + crypto.createHash('sha256').update(data).digest('base64') + ':';
  const compressed = await fs.readFile(`third_party/three_js/${ver}.js.br`);
  return {ver: ver, data: data, hashV1: hashV1, hashV2: hashV2, compressed: compressed};
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
    deltaMap[script.hashV1] = {};
    deltaMap[script.hashV2] = {};
  })

  promises = [];
  THREE_JS_VERSIONS.forEach((from) => {
    THREE_JS_VERSIONS.forEach((to) => {
      promises.push(loadThreeJsDelta(from, to));
    });
  });
  const delatas = await Promise.all(promises);
  delatas.forEach((delta) => {
    deltaMap[scriptMap[delta.from].hashV1][delta.to] = delta;
    deltaMap[scriptMap[delta.from].hashV2][delta.to] = delta;
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
    reply.header('cache-control', 'public, max-age=1000');
    reply.header('use-as-dictionary', 'match="/js/*"');
    reply.header('vary', 'sec-available-dictionary, available-dictionary');
    const threeJsInfo = await threeJsInfoPromise;
    const dictHashV1 = request.headers['sec-available-dictionary'];
    const dictHashV2 = request.headers['available-dictionary'];
    const acceptEncodings = request.headers['accept-encoding'].split(',');
    const sbrSupported = acceptEncodings.some(x => x.trim()=='sbr');
    const szstSupported = acceptEncodings.some(x => x.trim()=='zstd-d');
    if (dictHashV1 && 
        (sbrSupported || szstSupported) &&
        threeJsInfo.deltaMap[dictHashV1] &&
        threeJsInfo.deltaMap[dictHashV1][ver]) {
      if (szstSupported) {
        reply.header('content-encoding', 'zstd-d');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHashV1][ver].szst));
      } else {
        reply.header('content-encoding', 'sbr');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHashV1][ver].sbr));
      }
    } else if (dictHashV2 && (sbrSupported || szstSupported) &&
               threeJsInfo.deltaMap[dictHashV2] &&
               threeJsInfo.deltaMap[dictHashV2][ver]) {
      reply.header('content-dictionary', dictHashV2);
      if (szstSupported) {
        reply.header('content-encoding', 'zstd-d');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHashV2][ver].szst));
      } else {
        reply.header('content-encoding', 'br-d');
        reply.send(Buffer.from(threeJsInfo.deltaMap[dictHashV2][ver].sbr));
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
