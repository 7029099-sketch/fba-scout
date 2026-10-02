const MARKETPLACES={US:'https://www.amazon.com',UK:'https://www.amazon.co.uk',DE:'https://www.amazon.de'};

function clean(v=''){return String(v).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function abs(base,href){try{return new URL(href,base).href}catch{return''}}
function safe(v){try{let raw=String(v||'').trim();if(!raw)return null;if(!/^https?:\/\//i.test(raw))raw='https://'+raw.replace(/^\/\//,'');const u=new URL(raw);if(!/^https?:$/.test(u.protocol))return null;const h=u.hostname.toLowerCase();if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h.endsWith('.local')||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h))return null;return u}catch{return null}}
function send(res,status,body){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(body))}
async function getText(url,ms=3000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*;q=0.7','accept-language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
function meta(html,key){for(const p of [new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,'i')]){const m=html.match(p);if(m)return clean(m[1])}return''}
function titleOf(html){return clean(meta(html,'og:title')||meta(html,'twitter:title')||((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''))}
function imageOf(html,base){const x=meta(html,'og:image')||meta(html,'twitter:image');return x?abs(base,x):''}
function priceOf(html){for(const v of [meta(html,'product:price:amount'),meta(html,'og:price:amount')])if(v)return v;const m=html.match(/(?:£|\$|€|US\$|USD|EUR|GBP|CNY|RMB|¥)\s?([0-9]+(?:[.,][0-9]{1,2})?)/i);return m?m[1].replace(',','.') : ''}
function currencyOf(html){const c=meta(html,'product:price:currency')||meta(html,'og:price:currency');if(c)return c.toUpperCase();if(/(?:CNY|RMB|¥)/i.test(html))return'CNY';if(/(?:GBP|£)/i.test(html))return'GBP';if(/(?:EUR|€)/i.test(html))return'EUR';if(/(?:US\$|USD|\$)/i.test(html))return'USD';return''}
function jsonLdProducts(html,base){const out=[];const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(html))){try{const data=JSON.parse(m[1]);const q=Array.isArray(data)?[...data]:[data];while(q.length){const x=q.shift();if(!x||typeof x!=='object')continue;if(Array.isArray(x['@graph']))q.push(...x['@graph']);if(Array.isArray(x.itemListElement))q.push(...x.itemListElement.map(y=>y.item||y));const typ=x['@type'];if(typ==='Product'||(Array.isArray(typ)&&typ.includes('Product'))){const offer=Array.isArray(x.offers)?x.offers[0]:x.offers||{};const img=Array.isArray(x.image)?x.image[0]:x.image||'';out.push({name:clean(x.name||''),url:abs(base,x.url||base),image:abs(base,img),price:String(offer.price||''),currency:String(offer.priceCurrency||'')})}}}catch{}}return out}

function anchors(html,base){const out=[];const re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){const href=abs(base,m[1]);if(href)out.push({href,txt:clean(m[2])})}return out}
function sameHost(a,b){try{return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'')}catch{return false}}
function looksProductUrl(v){try{const p=new URL(v).pathname.toLowerCase();return /\/products?\/[^/]+|\/product[-_/][^/]+|\/item[-_/][^/]+|\/goods[-_/][^/]+|\/detail[-_/][^/]+|\/sku[-_/][^/]+|\/p\/[^/]+|\/shop\/[^/]+/.test(p)}catch{return false}}
function looksCategoryUrl(v){try{const p=new URL(v).pathname.toLowerCase();return /collection|collections|category|categories|catalog|shop|products|product-list/.test(p)&&!looksProductUrl(v)}catch{return false}}
function productLinks(html,base,limit=250){const out=[],seen=new Set();for(const a of anchors(html,base)){if(out.length>=limit)break;if(!sameHost(base,a.href)||seen.has(a.href)||!looksProductUrl(a.href))continue;seen.add(a.href);out.push(a.href)}return out}
function categoryLinks(html,base,limit=4){const out=[],seen=new Set();for(const a of anchors(html,base)){if(out.length>=limit)break;if(!sameHost(base,a.href)||seen.has(a.href)||!looksCategoryUrl(a.href))continue;seen.add(a.href);out.push(a.href)}return out}
function parseLocs(xml){const out=[];const re=/<loc>\s*([^<]+?)\s*<\/loc>/gi;let m;while((m=re.exec(xml)))out.push(clean(m[1]).replace(/&amp;/g,'&'));return out}
function uniq(xs,limit=250){const out=[],seen=new Set();for(const x of xs){if(out.length>=limit)break;if(!x||seen.has(x))continue;seen.add(x);out.push(x)}return out}

async function sitemapCandidates(root,limit){const origin=root.origin;const mapUrls=[];try{const robots=await getText(origin+'/robots.txt',1400);for(const m of robots.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)/gim))mapUrls.push(m[1].trim())}catch{}
  mapUrls.push(origin+'/sitemap.xml',origin+'/sitemap_index.xml',origin+'/server-sitemap-index-products.xml');
  const first=uniq(mapUrls,8);const found=[];const childMaps=[];
  const docs=await Promise.all(first.map(async url=>{try{return{url,text:await getText(url,1800)}}catch{return null}}));
  for(const d of docs.filter(Boolean)){for(const loc of parseLocs(d.text)){if(!sameHost(origin,loc))continue;if(looksProductUrl(loc))found.push(loc);else if(/sitemap|\.xml(?:\?|$)/i.test(loc)&&/product|shop|catalog/i.test(loc))childMaps.push(loc)}}
  if(found.length<Math.min(20,limit)&&childMaps.length){const kids=await Promise.all(uniq(childMaps,4).map(async url=>{try{return await getText(url,1800)}catch{return''}}));for(const xml of kids)for(const loc of parseLocs(xml))if(sameHost(origin,loc)&&looksProductUrl(loc))found.push(loc)}
  return uniq(found,limit)
}
async function pageCandidates(root,html,limit){const found=[...productLinks(html,root.href,limit)];if(found.length>=10)return uniq(found,limit);const cats=categoryLinks(html,root.href,3);const pages=await Promise.all(cats.map(async url=>{try{return{url,html:await getText(url,1800)}}catch{return null}}));for(const p of pages.filter(Boolean))found.push(...productLinks(p.html,p.url,limit));return uniq(found,limit)}

function detailProduct(html,url){const j=jsonLdProducts(html,url);if(j.length){const x=j.find(v=>v.url===url)||j[0];return{...x,url:x.url||url,name:x.name||titleOf(html),image:x.image||imageOf(html,url),price:x.price||priceOf(html),currency:x.currency||currencyOf(html)}}const name=titleOf(html);if(!name)return null;return{name,url,image:imageOf(html,url),price:priceOf(html),currency:currencyOf(html)}}

const STOP=new Set(['with','for','the','and','from','this','that','new','pack','set','usb','type','port','ports','charger','charging','adapter','wall','plug']);
function tokens(s){return new Set(clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>1&&!STOP.has(x)))}
function similarity(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return .75*(hit/A.size)+.25*(hit/B.size)}
function parseAmazon(html,base){const out=[],seen=new Set();const blocks=html.split(/(?=<div[^>]+data-component-type=["']s-search-result["'])/i);for(const block of blocks){const asin=((block.match(/data-asin=["']([A-Z0-9]{10})["']/i)||[])[1]||'');if(!asin||seen.has(asin))continue;const title=clean(((block.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||((block.match(/aria-label=["']([^"']{10,220})["']/i)||[])[1]||''));if(!title)continue;const price=clean(((block.match(/<span class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/i)||[])[1]||''));seen.add(asin);out.push({asin,title,price,url:base+'/dp/'+asin});if(out.length>=8)break}return out}
function compactQuery(name){return clean(name).replace(/[|®™]/g,' ').split(/\s+/).filter(Boolean).slice(0,8).join(' ')}
async function amazonMatch(name,market='US'){const base=MARKETPLACES[market]||MARKETPLACES.US,query=compactQuery(name)||name,searchUrl=base+'/s?k='+encodeURIComponent(query);try{const html=await getText(searchUrl,2800);const items=parseAmazon(html,base).map(x=>({...x,similarity:Math.round(similarity(name,x.title)*100)})).sort((a,b)=>b.similarity-a.similarity).slice(0,5);const best=items[0]||null;if(best&&best.similarity>=48)return{state:'found',searchUrl,best,items,verified:true};if(items.length)return{state:'not_found',searchUrl,best:null,items,verified:true};return{state:'unverified',searchUrl,best:null,items:[],verified:false,note:'Amazon не дал надёжный ответ'}}catch{return{state:'unverified',searchUrl,best:null,items:[],verified:false,note:'Amazon заблокировал или не ответил вовремя'}}}

module.exports=async function handler(req,res){try{
  if(req.method!=='POST')return send(res,405,{error:'POST only'});
  let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body)}catch{body={}}}
  const action=body.action||'discover';
  if(action==='discover'){
    const u=safe(body.url);if(!u)return send(res,400,{error:'Некорректный URL'});const cap=Math.max(20,Math.min(Number(body.limit)||120,200));
    let html='';try{html=await getText(u.href,2800)}catch{}
    const quick=html?productLinks(html,u.href,cap):[];
    let maps=[],pages=[];
    if(quick.length<cap){[maps,pages]=await Promise.all([sitemapCandidates(u,cap),html?pageCandidates(u,html,cap):Promise.resolve([])])}
    const productUrls=uniq([...quick,...maps,...pages],cap);
    const warning=!productUrls.length?'Не удалось автоматически найти товарные URL. Сайт может скрывать каталог за JavaScript/Cloudflare.':'';
    return send(res,200,{source:{url:u.href,host:u.host,title:html?titleOf(html):''},productUrls,totalDiscovered:productUrls.length,warning,mode:'fast_domain_discovery'});
  }
  if(action==='analyze'){
    const urls=Array.isArray(body.urls)?body.urls.slice(0,2):[],market=body.marketplace||'US';if(!urls.length)return send(res,400,{error:'Нет URL товаров для анализа'});
    const fetched=await Promise.all(urls.map(async url=>{const u=safe(url);if(!u)return null;try{return detailProduct(await getText(u.href,2600),u.href)}catch{return null}}));
    const products=await Promise.all(fetched.filter(Boolean).map(async p=>({...p,amazon:await amazonMatch(p.name,market)})));
    return send(res,200,{products,count:products.length,mode:'small_batch_analysis'});
  }
  return send(res,400,{error:'Неизвестный режим'});
}catch(e){return send(res,200,{products:[],error:'Ошибка сканера',details:e&&e.message?e.message:String(e)})}}
