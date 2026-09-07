const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const express = require('express');

test('BLE HTTP routes communicate with gateway over Unix socket', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-ble-'));
  process.env.MESH_SOCKET_PATH = path.join(temp, 'gateway.sock');
  let commands = [];
  let respond = () => ({ success: true, message: 'accepted' });
  const gateway = net.createServer(socket => {
    let buffer = '';
    socket.on('data', data => {
      buffer += data.toString();
      if (!buffer.includes('\n')) return;
      const command = JSON.parse(buffer.split('\n')[0]);
      commands.push(command);
      socket.end(JSON.stringify(respond(command)) + '\n');
    });
  });
  await new Promise(resolve => gateway.listen(process.env.MESH_SOCKET_PATH, resolve));
  const app = express();
  app.use(express.json());
  app.use('/api/ble', require('../routes/ble'));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (gateway.listening) await new Promise(resolve => gateway.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/ble`;
  const post = (action, body = {}) => fetch(`${base}/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  await t.test('scan is accepted and reaches the gateway', async () => {
    const response = await post('scan');
    assert.equal(response.status, 202);
    assert.equal(commands.at(-1).action, 'scan');
  });
  await t.test('invalid UUID is rejected before dispatch', async () => {
    const count = commands.length;
    assert.equal((await post('provision', { uuid: '../bad' })).status, 400);
    assert.equal(commands.length, count);
  });
  await t.test('provision/configure preserve UUID', async () => {
    const uuid = 'ab'.repeat(16);
    for (const action of ['provision', 'configure']) {
      assert.equal((await post(action, { uuid })).status, 202);
      assert.deepEqual(commands.at(-1), { action, uuid });
    }
  });
  await t.test('gateway rejection is not reported as success', async () => {
    respond = () => ({ success: false, error: 'Gateway busy' });
    const response = await post('scan');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'Gateway busy');
  });
  await t.test('status reflects live gateway response', async () => {
    respond = () => ({ success: true, data: { state: 'attached', ready: true } });
    const result = await (await fetch(`${base}/status`)).json();
    assert.equal(result.data.ready, true);
    assert.equal(commands.at(-1).action, 'status');
  });
  await t.test('offline gateway returns failure and offline status', async () => {
    await new Promise(resolve => gateway.close(resolve));
    assert.equal((await post('scan')).status, 503);
    const result = await (await fetch(`${base}/status`)).json();
    assert.equal(result.data.ready, false);
    assert.equal(result.data.state, 'not_started');
  });
});
