const MARKETPLACES={UK:'https://www.amazon.co.uk',US:'https://www.amazon.com',DE:'https://www.amazon.de'};

function clean(v=''){return String(v).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function abs(base,href){try{return new URL(href,base).href}catch{return''}}
function safe(v){try{let raw=String(v||'').trim();if(!raw)return null;if(!/^https?:\/\//i.test(raw))raw='https://'+raw.replace(/^\/\//,'');const u=new URL(raw);if(!/^https?:$/.test(u.protocol))return null;const h=u.hostname.toLowerCase();if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local')||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h))return null;return u}catch{return null}}
function send(res,status,body){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(body))}
async function getText(url,ms=5500){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*;q=0.7','accept-language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
function meta(html,key){for(const p of [new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,'i')]){const m=html.match(p);if(m)return clean(m[1])}return''}
function titleOf(html){return clean(meta(html,'og:title')||meta(html,'twitter:title')||((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''))}
function imageOf(html,base){const x=meta(html,'og:image')||meta(html,'twitter:image');return x?abs(base,x):''}
function priceOf(html){for(const v of [meta(html,'product:price:amount'),meta(html,'og:price:amount')])if(v)return v;const m=html.match(/(?:£|\$|€|US\$|USD|EUR|GBP|CNY|RMB|¥)\s?([0-9]+(?:[.,][0-9]{1,2})?)/i);return m?m[1].replace(',','.') : ''}
function currencyOf(html){const c=meta(html,'product:price:currency')||meta(html,'og:price:currency');if(c)return c.toUpperCase();if(/(?:CNY|RMB|¥)/i.test(html))return'CNY';if(/(?:GBP|£)/i.test(html))return'GBP';if(/(?:EUR|€)/i.test(html))return'EUR';if(/(?:US\$|USD|\$)/i.test(html))return'USD';return''}
function jsonLdProducts(html,base){const out=[];const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(html))){try{const data=JSON.parse(m[1]);const q=Array.isArray(data)?[...data]:[data];while(q.length){const x=q.shift();if(!x||typeof x!=='object')continue;if(Array.isArray(x['@graph']))q.push(...x['@graph']);if(Array.isArray(x.itemListElement))q.push(...x.itemListElement.map(y=>y.item||y));const typ=x['@type'];if(typ==='Product'||(Array.isArray(typ)&&typ.includes('Product'))){const offer=Array.isArray(x.offers)?x.offers[0]:x.offers||{};const img=Array.isArray(x.image)?x.image[0]:x.image||'';out.push({name:clean(x.name||''),url:abs(base,x.url||base),image:abs(base,img),price:String(offer.price||''),currency:String(offer.priceCurrency||'')})}}}catch{}}return out}
const GENERIC=/^(products?|shop|catalog|categories|home|about|contact|news|blog|read more|view more|learn more|details?|all products?)$/i;
function anchors(html,base){const out=[];const re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){const href=abs(base,m[1]);if(!href)continue;out.push({href,txt:clean(m[2])})}return out}
function looksProductUrl(v){try{const p=new URL(v).pathname.toLowerCase();return /\/products?\/[^/]+|\/product-|\/item\/[^/]+|\/goods\/[^/]+|\/detail\/[^/]+|\/sku\/[^/]+|\/p\/[^/]+/.test(p)}catch{return false}}
function productLinks(html,base,max=250){const host=new URL(base).host,out=[],seen=new Set();for(const a of anchors(html,base)){if(out.length>=max)break;let u;try{u=new URL(a.href)}catch{continue}if(u.host!==host||seen.has(a.href)||!looksProductUrl(a.href))continue;if(a.txt&&GENERIC.test(a.txt))continue;seen.add(a.href);out.push(a.href)}return out}
function categoryLinks(html,base,max=12){const host=new URL(base).host,out=[],seen=new Set();for(const a of anchors(html,base)){if(out.length>=max)break;let u;try{u=new URL(a.href)}catch{continue}if(u.host!==host||seen.has(a.href))continue;const p=u.pathname.toLowerCase();if(!(/collection|category|catalog|shop|products/.test(p))||looksProductUrl(a.href))continue;seen.add(a.href);out.push(a.href)}return out}
function parseLocs(xml){const out=[];const re=/<loc>\s*([^<]+?)\s*<\/loc>/gi;let m;while((m=re.exec(xml)))out.push(clean(m[1]).replace(/&amp;/g,'&'));return out}
function sameHost(base,url){try{return new URL(base).host===new URL(url).host}catch{return false}}
async function discoverSitemaps(root,limit=250){const found=new Set(),queue=[],visited=new Set();const origin=root.origin;
  try{const robots=await getText(origin+'/robots.txt',3500);const declared=[];for(const m of robots.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)/gim))declared.push(m[1].trim());declared.sort((a,b)=>(/product/i.test(a)?-1:0)-(/product/i.test(b)?-1:0));queue.push(...declared)}catch{}
  queue.push(origin+'/server-sitemap-index-products.xml',origin+'/sitemap.xml',origin+'/sitemap_index.xml');
  while(queue.length&&visited.size<40&&found.size<limit){const sm=queue.shift();if(visited.has(sm))continue;visited.add(sm);let xml;try{xml=await getText(sm,4500)}catch{continue}const locs=parseLocs(xml);for(const loc of locs){if(found.size>=limit)break;if(!sameHost(origin,loc))continue;const isMap=/\.xml(?:\?|$)/i.test(loc)||(/sitemap/i.test(loc)&&!looksProductUrl(loc));if(isMap){if(queue.length<80&&!visited.has(loc)){if(/product/i.test(loc))queue.unshift(loc);else queue.push(loc)}continue}if(looksProductUrl(loc))found.add(loc)}}
  return [...found]
}
async function discoverFromPages(root,html,limit=250){const found=new Set(productLinks(html,root.href,limit));const cats=categoryLinks(html,root.href,10);for(let i=0;i<cats.length&&found.size<limit;i+=4){const batch=cats.slice(i,i+4);const pages=await Promise.all(batch.map(async url=>{try{return{url,html:await getText(url,3500)}}catch{return null}}));for(const p of pages.filter(Boolean))for(const u of productLinks(p.html,p.url,limit))if(found.size<limit)found.add(u)}return [...found]}
function detailProduct(html,url){const json=jsonLdProducts(html,url);if(json.length){const exact=json.find(x=>x.url===url)||json[0];return{...exact,url:exact.url||url,name:exact.name||titleOf(html),image:exact.image||imageOf(html,url),price:exact.price||priceOf(html),currency:exact.currency||currencyOf(html)}}const name=titleOf(html);if(!name)return null;return{name,url,image:imageOf(html,url),price:priceOf(html),currency:currencyOf(html)} }
const STOP=new Set(['with','for','the','and','from','this','that','new','pack','set','usb','type','port','ports','charger','charging','adapter','wall','plug']);
function tokens(s){return new Set(clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>1&&!STOP.has(x)))}
function similarity(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return .75*(hit/A.size)+.25*(hit/B.size)}
function parseAmazon(html,base){const out=[],seen=new Set();const blocks=html.split(/(?=<div[^>]+data-component-type=["']s-search-result["'])/i);for(const block of blocks){const asin=((block.match(/data-asin=["']([A-Z0-9]{10})["']/i)||[])[1]||'');if(!asin||seen.has(asin))continue;const title=clean(((block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||((block.match(/aria-label=["']([^"']{10,220})["']/i)||[])[1]||''));if(!title)continue;const price=clean(((block.match(/<span class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i)||[])[1]||''));seen.add(asin);out.push({asin,title,price,url:base+'/dp/'+asin});if(out.length>=10)break}return out}
function explicitNoResults(html){return /no results for|did not match any products|keine ergebnisse|keine treffer/i.test(clean(html.slice(0,120000)))}
function compactQuery(name){return clean(name).replace(/[|®™]/g,' ').split(/\s+/).filter(Boolean).slice(0,9).join(' ')}
async function amazonSearch(query,base){const searchUrl=base+'/s?k='+encodeURIComponent(query);const html=await getText(searchUrl,4800);return{searchUrl,html,items:parseAmazon(html,base)}}
async function amazonMatch(name,market='US'){const base=MARKETPLACES[market]||MARKETPLACES.US;const queries=[name,compactQuery(name)].filter((q,i,a)=>q&&a.indexOf(q)===i);let all=[],searchUrl=base+'/s?k='+encodeURIComponent(name),sawNoResults=false;try{for(const q of queries){const r=await amazonSearch(q,base);searchUrl=r.searchUrl;sawNoResults=sawNoResults||explicitNoResults(r.html);all.push(...r.items);if(r.items.length)break}const byAsin=new Map();for(const x of all)if(!byAsin.has(x.asin))byAsin.set(x.asin,x);const items=[...byAsin.values()].map(x=>({...x,similarity:Math.round(similarity(name,x.title)*100)})).sort((a,b)=>b.similarity-a.similarity).slice(0,6);const best=items[0]||null;if(best&&best.similarity>=52)return{state:'found',searchUrl,best,items,verified:true};if(items.length||sawNoResults)return{state:'not_found',searchUrl,best:null,items,verified:true};return{state:'unverified',searchUrl,best:null,items:[],verified:false,note:'Amazon page could not be parsed reliably.'}}catch{return{state:'unverified',searchUrl,best:null,items:[],verified:false,note:'Amazon blocked or timed out.'}}}

module.exports=async function handler(req,res){try{
  if(req.method!=='POST')return send(res,405,{error:'POST only'});
  let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body)}catch{body={}}}
  const action=body.action||'discover';
  if(action==='discover'){
    const u=safe(body.url);if(!u)return send(res,400,{error:'Некорректный URL'});
    let html;try{html=await getText(u.href,7000)}catch(e){return send(res,200,{source:{url:u.href,host:u.host,title:''},productUrls:[],totalDiscovered:0,warning:'Сайт поставщика не дал автоматический доступ: '+e.message})}
    const cap=Math.max(20,Math.min(Number(body.limit)||200,300));
    const [siteMapUrls,pageUrls]=await Promise.all([discoverSitemaps(u,cap),discoverFromPages(u,html,cap)]);
    const merged=[];const seen=new Set();for(const x of [...siteMapUrls,...pageUrls]){if(merged.length>=cap)break;if(!seen.has(x)){seen.add(x);merged.push(x)}}
    if(!merged.length&&looksProductUrl(u.href))merged.push(u.href);
    return send(res,200,{source:{url:u.href,host:u.host,title:titleOf(html)},productUrls:merged,totalDiscovered:merged.length,mode:'domain_discovery'});
  }
  if(action==='analyze'){
    const urls=Array.isArray(body.urls)?body.urls.slice(0,6):[];const market=body.marketplace||'US';if(!urls.length)return send(res,400,{error:'Нет URL товаров для анализа'});
    const items=[];
    const fetched=await Promise.all(urls.map(async url=>{const u=safe(url);if(!u)return null;try{const html=await getText(u.href,5000);return detailProduct(html,u.href)}catch{return null}}));
    for(const p of fetched.filter(Boolean)){const amazon=await amazonMatch(p.name,market);items.push({...p,amazon})}
    return send(res,200,{products:items,count:items.length,mode:'batch_analysis'});
  }
  return send(res,400,{error:'Неизвестный режим'});
}catch(e){return send(res,200,{products:[],error:'Ошибка сканера',details:e&&e.message?e.message:String(e)})}}
