export type SecretEnvironment=Readonly<Record<string,string|undefined>>;
type Live={start():Promise<void>;refresh():Promise<void>;status():{state:string};withValue<T>(fn:(value:Record<string,string>)=>T):Promise<T>;close():void};
const unavailable=()=>Error('Vault console authentication unavailable');
export function createConsoleSecretsSource(input:Record<string,string|undefined>,factory?:()=>Live|Promise<Live>){
 const environment={...input};let pending:Promise<Live>|undefined,live:Live|undefined,closed=false;
 const validate=(values:Record<string,string>)=>{if(!/^sk_(test|live)_[A-Za-z0-9_-]+$/.test(values.CLERK_SECRET_KEY??''))throw unavailable();const key=values.CLERK_ENCRYPTION_KEY??'';if(!/^[A-Za-z0-9+/]{43}=$/.test(key)||Buffer.from(key,'base64').length!==32)throw unavailable();return{CLERK_SECRET_KEY:values.CLERK_SECRET_KEY!,CLERK_ENCRYPTION_KEY:key};};
 async function construct():Promise<Live>{
  if(factory)return factory();const {createApplicationRuntime}=await import('@kick-playr/local-key-vault/runtime-client');
  return createApplicationRuntime({application:'vault-app',scope:{environment:environment.LOCAL_KEYVAULT_ENVIRONMENT??'development',tenant:'_shared'},environment,allowedMappings:['CLERK_SECRET_KEY','CLERK_ENCRYPTION_KEY'],requiredMappings:['CLERK_SECRET_KEY','CLERK_ENCRYPTION_KEY'],intervalMs:1000,prepare:snapshot=>({value:validate(Object.fromEntries(snapshot.resources.map(r=>[r.mapping,r.value])))})});
 }
 return{async load():Promise<SecretEnvironment>{try{if(closed)throw unavailable();const strategy=environment.SECRETS_KEYS_STRATEGY??'ENV_VARIABLES';if(strategy==='ENV_VARIABLES')return Object.freeze({...environment});if(strategy!=='LOCAL_KEYVAULT'||!['development','test'].includes(environment.NODE_ENV??'')||environment.VERCEL!==undefined||environment.AWS_LAMBDA_FUNCTION_NAME!==undefined||['production','PROD'].includes(environment.STAGE??''))throw unavailable();
 const runtime=await(pending??=construct().then(async r=>{live=r;if(closed){r.close();throw unavailable();}await r.start();return r;}).catch(()=>{live?.close();live=undefined;pending=undefined;throw unavailable();}));await runtime.refresh();if(runtime.status().state!=='applied')throw unavailable();return await runtime.withValue(values=>Object.freeze({...environment,...validate(values)}));
 }catch{throw unavailable();}},close(){closed=true;live?.close();}};
}
