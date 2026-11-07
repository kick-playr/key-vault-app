/** Bounded metadata pagination. The table still renders 20 rows at a time. */
export async function loadResourceCatalogue<T extends {_id:string}>(fetchPage:(path:string)=>Promise<T[]>):Promise<T[]> {
 const rows:T[]=[],ids=new Set<string>();let after='';
 for(let pageNumber=0;pageNumber<=100;pageNumber++) {
  const page=await fetchPage('resources?limit=100'+(after?'&after='+encodeURIComponent(after):''));
  if(!Array.isArray(page)||page.length>100)throw Error('Invalid resource catalogue page');
  if(pageNumber===100 && page.length)throw Error('Resource catalogue exceeds the 10,000 resource viewer limit');
  for(const row of page) {
   if(typeof row?._id!=='string'||!row._id||ids.has(row._id)||row._id<=after)throw Error('Invalid resource catalogue cursor');
   ids.add(row._id);rows.push(row);
  }
  if(page.length<100)return rows;
  after=page.at(-1)!._id;
 }
 return rows;
}
