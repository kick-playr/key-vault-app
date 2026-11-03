import test from 'node:test';import assert from 'node:assert/strict';
import {parseApplications} from '../src/lib/applications';import {parseInventory} from '../src/lib/inventory';
const scope={environment:'dev',tenant:'club-a'};
test('application and inventory parsers retain formats without retaining secret values',()=>{
  const resource={kind:'secrets',name:'demo',envName:'EXAMPLE',policy:'latest',version:'a'.repeat(32),enabled:true,missing:false,tags:{},applications:['app'],valueFormat:'hex64',value:'VALUE_CANARY'};
  const model={...scope,revision:1,generation:1,applications:[{name:'app',displayName:'APP',description:'',supported:true,runtimeStatus:'not-connected',resources:[resource]}]};
  const parsed=parseApplications(model,scope);assert.equal(parsed.applications[0].resources[0].valueFormat,'hex64');assert(!JSON.stringify(parsed).includes('VALUE_CANARY'));
  assert.throws(()=>parseApplications({...model,applications:[{...model.applications[0],resources:[{...resource,valueFormat:'invalid'}]}]},scope));
  const id='http://127.0.0.1:4000/namespaces/dev/club-a/secrets/demo';
  const row={kind:'secret',name:'demo',version:'a'.repeat(32),id,versionId:id+'/'+ 'a'.repeat(32),attributes:{enabled:true},valueFormat:'base64',value:'VALUE_CANARY'};
  const inventory=parseInventory({value:[row]},'local/inventory',scope);assert.equal(inventory.rows[0].valueFormat,'base64');assert(!JSON.stringify(inventory).includes('VALUE_CANARY'));
  assert.throws(()=>parseInventory({value:[{...row,valueFormat:'invalid'}]},'local/inventory',scope));
});
