
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
  const hash = crypto.createHash('sha256').update(data).digest();
  const hashV1 = hash.toString('hex');
  const hashV2 = ':' + hash.toString('base64') + ':';
  const compressed = await fs.readFile(`third_party/three_js/${ver}.js.br`);
  return {ver: ver, data: data, hash: hash, hashV1: hashV1, hashV2: hashV2, compressed: compressed};
}

async function loadThreeJsDelta(from, to) {
  const sbr = await fs.readFile(`third_party/three_js/${from}-${to}.js.sbr`);
  const szst = await fs.readFile(`third_party/three_js/${from}-${to}.js.szst`);
  return {from: from, to: to, sbr: sbr, szst: szst};
}


const THREE_JS_VERSIONS = ['151', '152', '153'];
const DCB_MAGIC = Buffer.from([0xff, 0x44, 0x43, 0x42]);
const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

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
    deltaMap[script.hashV2].hash = script.hash;
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
    const dcbSupported = acceptEncodings.some(x => x.trim()=='dcb');
    const dczSupported = acceptEncodings.some(x => x.trim()=='dcz');
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
    } else if (dictHashV2 && (sbrSupported || szstSupported || dcbSupported || dczSupported) &&
               threeJsInfo.deltaMap[dictHashV2] &&
               threeJsInfo.deltaMap[dictHashV2][ver]) {
      reply.header('content-dictionary', dictHashV2);
      const deltaMap = threeJsInfo.deltaMap[dictHashV2];
      const delta = deltaMap[ver];
      if (dczSupported) {
        reply.header('content-encoding', 'dcz');
        reply.send(Buffer.concat([DCZ_MAGIC, deltaMap.hash, delta.szst]));
      } else if (dcbSupported) {
        reply.header('content-encoding', 'dcb');
        reply.send(Buffer.concat([DCB_MAGIC, deltaMap.hash, delta.sbr]));
      } else if (szstSupported) {
        reply.header('content-encoding', 'zstd-d');
        reply.send(Buffer.from(delta.szst));
      } else {
        reply.header('content-encoding', 'br-d');
        reply.send(Buffer.from(delta.sbr));
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
