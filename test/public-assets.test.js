const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');

const app = require('../src/app');

function request(server, assetPath) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: address.port,
        path: assetPath
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );

    req.on('error', reject);
  });
}

test('serves WhatsApp template images publicly', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const assetName of [
    'breakdown-image.png',
    'load-assignment-header.png'
  ]) {
    await t.test(`serves ${assetName} without authentication`, async () => {
      const response = await request(server, `/images/${assetName}`);
      const expectedImage = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'images', assetName)
      );

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'image/png');
      assert.deepEqual(response.body, expectedImage);
    });
  }
});
