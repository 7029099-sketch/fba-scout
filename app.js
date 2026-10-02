const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>'$'+(Number(v)||0).toFixed(2);
const pct=v=>(Number(v)||0).toFixed(0)+'%';
const MARKET='US';
const DEFAULTS={chinaLocal:.25,freight:1.8,duty:.35,broker:.2,prep:.4,partner:.15,inbound:.45,referral:15,fba:3.5,storage:.15,returnsPct:3,adPct:12,qty:100,target:24.99};
const FX={USD:1,CNY:.14,RMB:.14,GBP:1.34,EUR:1.17};
let scanData=[];
let opened=new Set();
let filter='all';
let loadTimer=null,loadStep=0;
let saved=JSON.parse(localStorage.getItem('fbaScoutSaved')||'[]');

function parsePrice(v){const n=parseFloat(String(v||'').replace(/[^0-9.,-]/g,'').replace(',','.'));return Number.isFinite(n)?n:0}
function median(arr){const a=arr.filter(n=>n>0).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function comparable(x){return median((x.amazon?.items||[]).map(y=>parsePrice(y.price)))}
function supplierUSD(x){const raw=parsePrice(x.price),c=String(x.currency||'USD').toUpperCase();return raw*(FX[c]||1)}
function initModel(x){if(x.model)return x.model;const sale=parsePrice(x.amazon?.best?.price)||comparable(x)||DEFAULTS.target;x.model={...DEFAULTS,unitCost:supplierUSD(x),salePrice:sale};return x.model}
function scenario(m,kind='base'){
  const freightMult=kind==='low'?1.25:kind==='high'?.9:1;
  const ad=kind==='low'?18:kind==='high'?8:+m.adPct||0;
  const ret=kind==='low'?5:kind==='high'?2:+m.returnsPct||0;
  const landed=(+m.unitCost||0)+(+m.chinaLocal||0)+((+m.freight||0)*freightMult)+(+m.duty||0)+(+m.broker||0)+(+m.prep||0)+(+m.partner||0)+(+m.inbound||0);
  const sale=+m.salePrice||0;
  const referral=sale*((+m.referral||0)/100);
  const amazon=referral+(+m.fba||0)+(+m.storage||0)+sale*(ret/100)+sale*(ad/100);
  const allIn=landed+amazon;
  const profit=sale-allIn;
  const roi=landed?profit/landed*100:0;
  return{landed,amazon,allIn,profit,roi,qty:+m.qty||100,batchProfit:profit*(+m.qty||100),capital:landed*(+m.qty||100)}
}
function rangeText(a,b,formatter=money){const lo=Math.min(a,b),hi=Math.max(a,b);return formatter(lo)+'–'+formatter(hi)}
function startLoading(){clearInterval(loadTimer);loadStep=0;$('loader').classList.add('show');$('scanBtn').disabled=true;const steps=[['Открываю сайт','Проверяю страницу и каталог'],['Собираю товары','Читаю фото, названия и цены'],['Сравниваю с Amazon','Ищу совпадающие листинги'],['Считаю экономику','Закупка, доставка, комиссии и ROI']];const paint=()=>{const s=steps[Math.min(loadStep,steps.length-1)];$('loaderTitle').textContent=s[0];$('loaderSub').textContent=s[1];$('progressBar').style.width=((loadStep+1)/steps.length*92)+'%'};paint();loadTimer=setInterval(()=>{loadStep=Math.min(loadStep+1,steps.length-1);paint()},1900)}
function stopLoading(ok=true){clearInterval(loadTimer);$('scanBtn').disabled=false;$('progressBar').style.width='100%';$('loaderTitle').textContent=ok?'Готово':'Ошибка';$('loaderSub').textContent=ok?'Результаты собраны ниже':'Не удалось закончить анализ';setTimeout(()=>$('loader').classList.remove('show'),900)}
async function scan(){const url=$('scanUrl').value.trim();if(!url)return alert('Вставь ссылку поставщика');startLoading();$('scanResults').innerHTML='';$('sourceInfo').textContent='Анализируем...';try{const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,marketplace:MARKET,maxProducts:16})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw new Error('Сервер вернул некорректный ответ')};if(data.error)throw new Error(data.details||data.error);scanData=(data.products||[]).map(x=>({...x}));scanData.forEach(initModel);opened.clear();$('sourceInfo').textContent=data.source?.host||url;renderSummary();renderScan();stopLoading(true)}catch(e){scanData=[];$('scanResults').innerHTML='<div class="empty">Не удалось проанализировать: '+esc(e.message)+'</div>';$('sourceInfo').textContent='Ошибка анализа';renderSummary();stopLoading(false)}}
function renderSummary(){const found=scanData.filter(x=>x.amazon?.state==='found').length,notFound=scanData.filter(x=>x.amazon?.state==='not_found').length,unverified=scanData.length-found-notFound;$('sTotal').textContent=scanData.length;$('sFound').textContent=found;$('sNew').textContent=notFound;$('sUnverified').textContent=unverified}
function statusHTML(st){if(st==='found')return '<span class="badge found">✓ Есть</span>';if(st==='not_found')return '<span class="badge not_found">✕ Нет</span>';return '<span class="badge unverified">? Проверить</span>'}
function riskText(name){const s=String(name||'').toLowerCase();if(/knife|knives|blade|machete|sword|dagger|switchblade|balisong/.test(s))return 'Категория с повышенным риском ограничений. Перед закупкой нужно проверить правила Amazon и разрешение Seller-аккаунта.';if(/battery|lithium|power bank|charger|rechargeable|electrical|adapter/.test(s))return 'Электротовар: перед закупкой нужно проверить документы, маркировку и требования Amazon к этой категории.';if(/baby|infant|toddler|children|kids/.test(s))return 'Детский товар: может потребоваться product-safety документация.';return 'Предварительно явных ограничений по названию не видно. Точное право продажи проверяется уже по конкретному ASIN и Seller-аккаунту.'}
function field(label,v,i,key,step='.01'){return `<label class="field"><span>${label}</span><input type="number" step="${step}" value="${Number(v)||0}" oninput="updateModel(${i},'${key}',this.value)"></label>`}
function renderScan(){let list=scanData;if(filter!=='all')list=list.filter(x=>x.amazon?.state===filter);if(!scanData.length){$('scanResults').innerHTML='<div class="empty">Товары не найдены. Попробуй страницу каталога или конкретный товар.</div>';return}if(!list.length){$('scanResults').innerHTML='<div class="empty">В этой группе ничего нет.</div>';return}$('scanResults').innerHTML=list.map(x=>{const i=scanData.indexOf(x),m=initModel(x),low=scenario(m,'low'),high=scenario(m,'high'),base=scenario(m,'base'),a=x.amazon||{},best=a.best||{},open=opened.has(i),st=a.state||'unverified',supplier=x.price?`${x.price}${x.currency?' '+x.currency:''}`:'—',amazonPrice=st==='found'?(best.price||money(m.salePrice)):st==='not_found'?'Новый листинг':'Проверить',profitClass=Math.max(low.profit,high.profit)<0?'loss':'profit';return `<article class="dealRow ${open?'open':''}">
<div class="dealMain" onclick="toggleDeal(${i})">
  <div class="productCell"><div class="thumb">${x.image?`<img src="${esc(x.image)}" alt="">`:'Нет фото'}</div><div class="productText"><h3>${esc(x.name)}</h3><a href="${esc(x.url||'#')}" target="_blank" onclick="event.stopPropagation()">Поставщик ↗</a></div></div>
  <div class="metric"><span>Закупка</span><b>${esc(supplier)}</b><div class="sub">≈ ${money(m.unitCost)}</div></div>
  <div class="metric statusCol"><span>Amazon</span>${statusHTML(st)}<div class="sub">${esc(amazonPrice)}</div></div>
  <div class="metric"><span>Себестоимость</span><b>${money(base.allIn)}</b><div class="sub">с учётом расходов</div></div>
  <div class="metric ${profitClass} profitCol"><span>Прибыль / шт</span><b>${rangeText(low.profit,high.profit)}</b></div>
  <div class="metric roi roiCol"><span>ROI</span><b>${rangeText(low.roi,high.roi,pct)}</b></div>
  <div class="chev">⌄</div>
</div>
<div class="dealDetails">
  <div class="qtyBar"><span>Партия:</span>${[10,100,200,300,1000].map(q=>`<button class="qtyChip ${(+m.qty||100)===q?'active':''}" onclick="event.stopPropagation();setQty(${i},${q})">${q}</button>`).join('')}</div>
  <div class="flow">
    <div class="flowNode"><span>Закупка</span><b>${money(m.unitCost)}</b></div>
    <div class="flowNode"><span>Логистика</span><b>${money((+m.chinaLocal||0)+(+m.freight||0)+(+m.duty||0)+(+m.broker||0))}</b></div>
    <div class="flowNode"><span>Prep + склад</span><b>${money((+m.prep||0)+(+m.partner||0)+(+m.inbound||0))}</b></div>
    <div class="flowNode"><span>Amazon fees</span><b>${money((+m.salePrice||0)*(+m.referral||0)/100+(+m.fba||0)+(+m.storage||0))}</b></div>
    <div class="flowNode"><span>Реклама + возвраты</span><b>${money((+m.salePrice||0)*((+m.adPct||0)+(+m.returnsPct||0))/100)}</b></div>
    <div class="flowNode"><span>Итого</span><b>${money(base.allIn)}</b></div>
  </div>
  <div class="detailGrid">
    ${field('Цена закупки, $',m.unitCost,i,'unitCost')}${field('Доставка по Китаю',m.chinaLocal,i,'chinaLocal')}${field('Международная доставка',m.freight,i,'freight')}${field('Пошлина',m.duty,i,'duty')}${field('Брокер / посредник',m.broker,i,'broker')}${field('Prep / label',m.prep,i,'prep')}
    ${field('Склад партнёра',m.partner,i,'partner')}${field('Inbound на Amazon',m.inbound,i,'inbound')}${field('Цена продажи',m.salePrice,i,'salePrice')}${field('Referral %',m.referral,i,'referral','.1')}${field('FBA fee',m.fba,i,'fba')}${field('Реклама %',m.adPct,i,'adPct','.1')}${field('Storage',m.storage,i,'storage')}${field('Возвраты %',m.returnsPct,i,'returnsPct','.1')}
  </div>
  <div class="detailTotals">
    <div class="detailTotal"><span>Капитал на партию</span><b>${money(base.capital)}</b></div>
    <div class="detailTotal"><span>Прибыль партии</span><b>${rangeText(low.batchProfit,high.batchProfit)}</b></div>
    <div class="detailTotal hero"><span>Прибыль / шт</span><b>${rangeText(low.profit,high.profit)}</b></div>
    <div class="detailTotal"><span>ROI</span><b>${rangeText(low.roi,high.roi,pct)}</b></div>
    <div class="detailTotal"><span>Amazon статус</span><b>${st==='found'?'Есть листинг':st==='not_found'?'Новый листинг':'Проверить'}</b></div>
  </div>
  <div class="detailFoot"><div><div class="links"><a href="${esc(a.searchUrl||'#')}" target="_blank">Поиск Amazon ↗</a>${best.url?`<a href="${esc(best.url)}" target="_blank">Листинг ↗</a>`:''}</div><div class="riskNote">${esc(riskText(x.name))}${best.asin?` · ASIN: ${esc(best.asin)}`:''}</div></div><button class="saveBtn" onclick="event.stopPropagation();saveItem(${i})">Сохранить</button></div>
</div></article>`}).join('')}
function toggleDeal(i){opened.has(i)?opened.delete(i):opened.add(i);renderScan()}
function setQty(i,q){if(!scanData[i])return;initModel(scanData[i]).qty=q;opened.add(i);renderScan()}
function updateModel(i,key,val){if(!scanData[i])return;initModel(scanData[i])[key]=Number(val)||0;opened.add(i);renderScan()}
function saveItem(i){const x=scanData[i];if(!x)return;const copy=JSON.parse(JSON.stringify(x));copy.savedAt=Date.now();saved.unshift(copy);localStorage.setItem('fbaScoutSaved',JSON.stringify(saved));renderSaved();alert('Сохранено')}
function renderSaved(){if(!saved.length){$('savedResults').innerHTML='<div class="empty">Пока ничего не сохранено.</div>';return}$('savedResults').innerHTML=saved.map((x,i)=>{const m=initModel(x),b=scenario(m,'base');return `<div class="dealRow"><div class="dealMain" style="cursor:default"><div class="productCell"><div class="thumb">${x.image?`<img src="${esc(x.image)}">`:'Нет фото'}</div><div class="productText"><h3>${esc(x.name)}</h3><a href="${esc(x.url||'#')}" target="_blank">Поставщик ↗</a></div></div><div class="metric"><span>Закупка</span><b>${money(m.unitCost)}</b></div><div class="metric statusCol"><span>Amazon</span>${statusHTML(x.amazon?.state)}</div><div class="metric"><span>Себестоимость</span><b>${money(b.allIn)}</b></div><div class="metric profit profitCol"><span>Прибыль</span><b>${money(b.profit)}</b></div><div class="metric roi roiCol"><span>ROI</span><b>${pct(b.roi)}</b></div><button class="chev" onclick="removeSaved(${i})">×</button></div></div>`}).join('')}
function removeSaved(i){saved.splice(i,1);localStorage.setItem('fbaScoutSaved',JSON.stringify(saved));renderSaved()}
function switchView(v){$('scannerView').classList.toggle('hidden',v!=='scanner');$('savedView').classList.toggle('hidden',v!=='saved');document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===v));if(v==='saved')renderSaved()}
$('scanBtn').onclick=scan;document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderScan()});document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>switchView(b.dataset.view));renderSaved();