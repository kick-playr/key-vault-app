import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConsoleSecretsSource} from '../src/lib/server-secrets-core';
const environment={NODE_ENV:'development',SECRETS_KEYS_STRATEGY:'LOCAL_KEYVAULT'};
const keys=(secret='sk_test_first')=>({CLERK_SECRET_KEY:secret,CLERK_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64')});
test('background refresh adopts Clerk changes without mutating process secrets',async()=>{
 let candidate=keys(),applied=candidate,closed=false;
 const source=createConsoleSecretsSource(environment,()=>({start:async()=>{},refresh:async()=>{applied=candidate;},status:()=>({state:'applied'}),withValue:async(fn:any)=>fn(applied),close(){closed=true;}}));
 assert.equal((await source.load()).CLERK_SECRET_KEY,'sk_test_first');candidate=keys('sk_test_second');await source.refresh();assert.equal((await source.load()).CLERK_SECRET_KEY,'sk_test_second');assert.equal('CLERK_SECRET_KEY'in environment,false);source.close();assert.ok(closed);
});
test('warm requests do not wait for a slow refresh',async()=>{
 let calls=0,release:()=>void=()=>{};const slow=new Promise<void>(resolve=>{release=resolve;});
 const source=createConsoleSecretsSource(environment,()=>({start:async()=>{},refresh:async()=>{calls++;await slow;},status:()=>({state:'applied'}),withValue:async(fn:any)=>fn(keys()),close(){}}));
 try{await Promise.race([source.load(),new Promise((_,reject)=>setTimeout(()=>reject(Error('initial load waited for extra refresh')),100))]);assert.equal(calls,0);const refreshing=source.refresh();const value=await Promise.race([source.load(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('warm load blocked')),100))]);assert.equal(value.CLERK_SECRET_KEY,'sk_test_first');release();await refreshing;}finally{release();source.close();}
});
test('unverified snapshots expire after five seconds even while refresh is pending',async()=>{
 let now=0;const source=createConsoleSecretsSource(environment,()=>({start:async()=>{},refresh:async()=>{},status:()=>({state:'applied'}),withValue:async(fn:any)=>fn(keys()),close(){}}),{now:()=>now});
 await source.load();now=5001;await assert.rejects(source.load(),/Vault console authentication unavailable/);await source.refresh();assert.equal((await source.load()).CLERK_SECRET_KEY,'sk_test_first');source.close();
});
test('failed startup never leaks credential details or falls back to stale ENV',async()=>{
 const source=createConsoleSecretsSource({...environment,CLERK_SECRET_KEY:'sk_test_stale'},()=>({start:async()=>{throw Error('PRIVATE_TOKEN');},refresh:async()=>{},status:()=>({state:'applied'}),withValue:async()=>{throw Error();},close(){}}));await assert.rejects(source.load(),error=>String(error)==='Error: Vault console authentication unavailable');source.close();
});
test('legacy console ENV stays compatible',async()=>{const source=createConsoleSecretsSource({CLERK_SECRET_KEY:'sk_test_existing'});assert.equal((await source.load()).CLERK_SECRET_KEY,'sk_test_existing');source.close();});
test('refresh warning blocks cached credentials immediately',async()=>{
 let state='applied';const source=createConsoleSecretsSource(environment,()=>({start:async()=>{},refresh:async()=>{state='warning';},status:()=>({state}),withValue:async(fn:any)=>fn(keys()),close(){}}));await source.load();await assert.rejects(source.refresh(),/Vault console authentication unavailable/);await assert.rejects(source.load(),/Vault console authentication unavailable/);source.close();
});
