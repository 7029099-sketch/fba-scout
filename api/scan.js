const MARKETPLACES={UK:'https://www.amazon.co.uk',US:'https://www.amazon.com',DE:'https://www.amazon.de'};

function cleanText(v=''){return String(v).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function abs(base,href){try{return new URL(href,base).href}catch{return ''}}
function safeUrl(v){try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol))throw 0;return u}catch{return null}}
async function get(url,ms=12000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; FBA-Scout/1.0)','accept':'text/html,application/xhtml+xml'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
function meta(html,key){const patterns=[new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,'i')];for(const p of patterns){const m=html.match(p);if(m)return cleanText(m[1])}return ''}
function titleOf(html){return cleanText(meta(html,'og:title')||meta(html,'twitter:title')||((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''))}
function imageOf(html,base){const x=meta(html,'og:image')||meta(html,'twitter:image');return x?abs(base,x):''}
function priceOf(html){const vals=[meta(html,'product:price:amount'),meta(html,'og:price:amount')];for(const v of vals){if(v)return v}const m=html.match(/(?:£|\$|€|US\$)\s?([0-9]+(?:[.,][0-9]{1,2})?)/);return m?m[1].replace(',','.') : ''}
function productJsonLd(html,base){const out=[];const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(html))){try{const data=JSON.parse(m[1]);const stack=Array.isArray(data)?[...data]:[data];while(stack.length){const x=stack.shift();if(!x||typeof x!=='object')continue;if(Array.isArray(x['@graph']))stack.push(...x['@graph']);const typ=x['@type'];const isProd=typ==='Product'||(Array.isArray(typ)&&typ.includes('Product'));if(isProd){const offer=Array.isArray(x.offers)?x.offers[0]:x.offers||{};const img=Array.isArray(x.image)?x.image[0]:x.image||'';out.push({name:cleanText(x.name||''),url:abs(base,x.url||''),image:abs(base,img),price:String(offer.price||''),currency:String(offer.priceCurrency||'')})}}}catch{}}
return out}
function productLinks(html,base,max){const host=new URL(base).host;const out=[];const seen=new Set();const re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))&&out.length<max*4){const href=abs(base,m[1]);if(!href||seen.has(href))continue;let u;try{u=new URL(href)}catch{continue}if(u.host!==host)continue;const txt=cleanText(m[2]);if(txt.length<3)continue;const p=u.pathname.toLowerCase();const looks=/product|item|goods|detail|offer|sku|p\//.test(p)||/product|item|buy|shop/i.test(txt);if(!looks)continue;seen.add(href);out.push({name:txt.slice(0,180),url:href,image:'',price:'',currency:''})}return out.slice(0,max)}
function tokens(s){return new Set(cleanText(s).toLowerCase().replace(/[^a-z0-9а-яёіїєґ]+/gi,' ').split(/\s+/).filter(x=>x.length>2))}
function sim(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(A.size,B.size)}
function parseAmazon(html,base){const out=[];const seen=new Set();const re=/<div[^>]+data-asin=["']([A-Z0-9]{10})["'][\s\S]*?(?=<div[^>]+data-asin=|$)/gi;let m;while((m=re.exec(html))&&out.length<6){const block=m[0],asin=m[1];if(seen.has(asin))continue;seen.add(asin);const title=cleanText(((block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||((block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||''));if(!title)continue;const price=((block.match(/<span class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i)||[])[1]||'');out.push({asin,title,price:cleanText(price),url:base+'/dp/'+asin})}return out}
async function amazonMatch(name,marketplace){const base=MARKETPLACES[marketplace]||MARKETPLACES.UK;const searchUrl=base+'/s?k='+encodeURIComponent(name);try{const html=await get(searchUrl,9000);const items=parseAmazon(html,base).map(x=>({...x,similarity:Math.round(sim(name,x.title)*100)})).sort((a,b)=>b.similarity-a.similarity);const best=items[0]||null;let state='not_found';if(best&&best.similarity>=55)state='found';else if(best&&best.similarity>=25)state='similar';return {state,searchUrl,best,items}}catch(e){return {state:'needs_review',searchUrl,best:null,items:[],note:'Amazon blocked automated lookup or returned an unsupported page'}}}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const {url,marketplace='UK',maxProducts=12}=req.body||{};const u=safeUrl(url);if(!u)return res.status(400).json({error:'Некорректный URL'});
  const max=Math.max(1,Math.min(Number(maxProducts)||12,20));
  try{
    const html=await get(u.href);
    let candidates=productJsonLd(html,u.href);
    if(!candidates.length){const pageTitle=titleOf(html);if(pageTitle)candidates.push({name:pageTitle,url:u.href,image:imageOf(html,u.href),price:priceOf(html),currency:''})}
    const links=productLinks(html,u.href,max);
    for(const x of links)if(!candidates.some(c=>c.url===x.url))candidates.push(x);
    candidates=candidates.slice(0,max);
    const detailed=await Promise.all(candidates.map(async c=>{if(!c.url||c.url===u.href)return c;try{const h=await get(c.url,7000);return {...c,name:titleOf(h)||c.name,image:imageOf(h,c.url)||c.image,price:priceOf(h)||c.price}}catch{return c}}));
    const checked=[];for(const c of detailed){if(!c.name)continue;const amazon=await amazonMatch(c.name,marketplace);checked.push({...c,amazon});if(checked.length>=max)break}
    return res.json({source:{url:u.href,host:u.host,title:titleOf(html)},marketplace,count:checked.length,products:checked,notes:['Сканер работает best-effort: некоторые сайты защищены от автоматического чтения.','Amazon может ограничивать автоматические запросы. В таком случае сохраняется ссылка на ручной поиск.']});
  }catch(e){return res.status(502).json({error:'Не удалось прочитать сайт',details:e.message})}
}
