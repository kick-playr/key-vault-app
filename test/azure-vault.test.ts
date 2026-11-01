import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSecretFile, utcEpoch, parseVersions } from '../src/lib/azure-vault';
const scope = { environment: 'development', tenant: 'club-a' };
const id = 'http://127.0.0.1:4000/namespaces/development/club-a/secrets/demo/';
test('imports exact UTF-8 including BOM and newlines, enforcing byte limits', () => {
  assert.equal(decodeSecretFile(new TextEncoder().encode('\ufeffhello\r\n')), '\ufeffhello\r\n');
  assert.throws(() => decodeSecretFile(new Uint8Array([0xff])));
  assert.throws(() => decodeSecretFile(new Uint8Array()));
  assert.throws(() => decodeSecretFile(new TextEncoder().encode('é'.repeat(12801))));
  assert.equal(decodeSecretFile(new TextEncoder().encode('é'.repeat(12800))).length,12800);
});
test('UTC dates reject normalized impossible dates and negative times', () => {
  assert.equal(utcEpoch('2026-11-01T12:30'),1793536200);
  for (const v of ['2026-02-30T12:00','1969-12-31T12:00','2026-11-01','junk']) assert.throws(() => utcEpoch(v));
});
test('history preserves creation order and projects only metadata', () => {
  const result = parseVersions({value:[{id:id+'v1',attributes:{enabled:true,created:1,updated:1},value:'never-retain'},{id:id+'v2',attributes:{enabled:false,created:2,updated:2}}]},'secrets',scope,'demo');
  assert.deepEqual(result.map(v=>v.version),['v1','v2']);
  assert.equal(result.at(-1)?.attributes.enabled,false);
  assert.equal(JSON.stringify(result).includes('never-retain'),false);
  assert.throws(()=>parseVersions({value:[{id:id.replace('club-a','club-b')+'v1',attributes:{enabled:true}}]},'secrets',scope,'demo'));
  assert.throws(()=>parseVersions({value:[{id:id+'v1?value=bad',attributes:{enabled:true}}]},'secrets',scope,'demo'));
});
