import test from 'node:test';
import assert from 'node:assert/strict';
import {loadResourceCatalogue} from '../src/lib/static-resource-catalogue';
test('loads every metadata page beyond the former 220-resource boundary',async()=>{
 const rows=Array.from({length:251},(_,i)=>({_id:String(i).padStart(4,'0')}));let calls=0;
 const result=await loadResourceCatalogue(async path=>{calls++;const q=new URL('http://fixture/'+path).searchParams;assert.equal(q.get('limit'),'100');const after=q.get('after');const start=after===null?0:Number(after)+1;return rows.slice(start,start+100)});
 assert.equal(result.length,251);assert.equal(result.at(-1)?._id,'0250');assert.equal(calls,3);
});
test('rejects a repeated cursor instead of silently duplicating resource metadata',async()=>{
 const rows=Array.from({length:100},(_,i)=>({_id:String(i).padStart(4,'0')}));
 await assert.rejects(loadResourceCatalogue(async()=>rows),/cursor/);
});
