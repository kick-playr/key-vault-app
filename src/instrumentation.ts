/** Initialize SDK-owned encryption defaults before Clerk is imported in a worker. */
export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&['development','test'].includes(process.env.NODE_ENV??'')&&process.env.SECRETS_KEYS_STRATEGY==='LOCAL_KEYVAULT'){
  const{serverSecrets}=await import('./lib/server-secrets');await serverSecrets();
 }
}
