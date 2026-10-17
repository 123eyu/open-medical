import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';

const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

test('appointment retry is atomic, durable, patient-scoped and does not suppress intentional repeats', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'appointment-retry-'));
  const database = join(dir, 'synthetic.sqlite');
  const cleanups = [];
  const context = { after: fn => cleanups.push(fn) };
  let f = await fixture(context, { database, followupOptions: { autoStart: false } });
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); rmSync(dir, { recursive: true, force: true }); });
  const p = (await f.json('/api/patients', 'POST', { name: '虚构预约重试甲' })).data;
  const q = (await f.json('/api/patients', 'POST', { name: '虚构预约重试乙' })).data;
  const url = `/api/patients/${p.id}/appointments`;
  const payload = { date: today(), time: '09:00', reason: '合成复查', place: '虚构门诊', requestId: 'same-submission' };
  const [first, retry] = await Promise.all([f.json(url, 'POST', payload), f.json(url, 'POST', payload)]);
  assert.equal(first.status, 201); assert.equal(retry.status, 201);
  assert.equal(first.data.id, retry.data.id);
  assert.equal((await f.json(url)).data.appointments.length, 1);
  assert.equal((await f.json('/api/doctor/overview?kind=visit')).data.items.filter(x => x.patientId === p.id).length, 1);
  assert.equal((await f.json(url, 'POST', { ...payload, time: '11:00' })).status, 409);
  assert.equal((await f.json(url)).data.appointments[0].time, '09:00');
  const other = await f.json(`/api/patients/${q.id}/appointments`, 'POST', payload);
  assert.equal(other.status, 201); assert.notEqual(other.data.id, first.data.id);
  await cleanups.pop()();
  f = await fixture(context, { database, followupOptions: { autoStart: false } });
  const afterRestart = await f.json(url, 'POST', payload);
  assert.equal(afterRestart.data.id, first.data.id);
  assert.equal((await f.json(url)).data.appointments.length, 1);
  const intentional = await f.json(url, 'POST', { ...payload, requestId: 'intentional-second' });
  assert.equal(intentional.status, 201); assert.notEqual(intentional.data.id, first.data.id);
  assert.equal((await f.json(url)).data.appointments.length, 2);
});

test('failed appointment audit rolls back both creation and its retry key', async t => {
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  const p = (await f.json('/api/patients', 'POST', { name: '虚构预约事务' })).data;
  const url = `/api/patients/${p.id}/appointments`;
  const store = f.server.schedule?.store || f.server.workspaces.store;
  const original = store.audit.bind(store);
  const mocked = t.mock.method(store, 'audit', (...args) => { if (args[1] === 'appointment.created') throw new Error('synthetic audit failure'); return original(...args); });
  const payload = { date: today(), requestId: 'rollback-submission' };
  assert.equal((await f.json(url, 'POST', payload)).status, 500);
  assert.equal((await f.json(url)).data.appointments.length, 0);
  mocked.mock.restore();
  assert.equal((await f.json(url, 'POST', payload)).status, 201);
  assert.equal((await f.json(url)).data.appointments.length, 1);
});
