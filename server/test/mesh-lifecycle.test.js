const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const express = require('express');

test('zones require configured nodes and DELETE waits for gateway reset', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-life-'));
  process.env.DB_PATH = path.join(temp, 'db.sqlite');
  process.env.MESH_SOCKET_PATH = path.join(temp, 'mesh.sock');
  const { initDatabase, getDb } = require('../db/database');
  initDatabase();
  const db = getDb();
  db.exec(`INSERT INTO zones(id,name) VALUES(1,'demo'),(2,'pending'),(3,'joined');
    INSERT INTO ble_nodes(id,uuid,mesh_address,zone_id,status) VALUES
      (1,'53504d31000102030405060708090a0b','0x0002',2,'provisioned'),
      (2,'53504d31000102030405060708090a0c','0x0003',3,'configured');`);
  let command;
  const gateway = net.createServer(socket => socket.on('data', data => {
    command = JSON.parse(data.toString());
    socket.end(JSON.stringify({success:true})+'\n');
  }));
  await new Promise(resolve => gateway.listen(process.env.MESH_SOCKET_PATH, resolve));
  const app = express(); app.use(express.json());
  app.use('/zones', require('../routes/zone'));
  app.use('/ble', require('../routes/ble'));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  t.after(async () => {
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>gateway.close(resolve));
    db.close(); fs.rmSync(temp,{recursive:true,force:true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const zones = await (await fetch(base+'/zones')).json();
  assert.deepEqual(zones.data.map(z=>z.name), ['joined']);
  const create = await fetch(base+'/zones',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"manual"}'});
  assert.equal(create.status,409);
  const remove = await fetch(base+'/ble/nodes/2',{method:'DELETE'});
  assert.equal(remove.status,202);
  assert.deepEqual(command,{action:'remove',uuid:'53504d31000102030405060708090a0c'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ble_nodes WHERE id=2').get().n,1);
});
