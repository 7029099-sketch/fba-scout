async function fullSiteScan(){
  const url=$('scanUrl').value.trim();
  if(!url)return alert('Вставь основной сайт поставщика, например https://brand.com');
  startLoading();
  scanData=[];opened.clear();renderSummary();
  $('scanResults').innerHTML='';
  $('sourceInfo').textContent='Ищу каталог товаров на сайте…';
  try{
    const discoveryResponse=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'discover',url,limit:200})});
    const discoveryText=await discoveryResponse.text();
    let discovery;try{discovery=JSON.parse(discoveryText)}catch{throw new Error('Не удалось прочитать ответ сервера')}
    if(discovery.error)throw new Error(discovery.details||discovery.error);
    const urls=discovery.productUrls||[];
    if(!urls.length){
      scanData=[];renderSummary();
      $('scanResults').innerHTML='<div class="empty">Не нашёл карточки товаров автоматически. Возможно, сайт закрывает каталог от сканирования или формирует его только через JavaScript.</div>';
      $('sourceInfo').textContent=discovery.warning||'Товарные страницы не найдены';
      stopLoading(false);return;
    }
    clearInterval(loadTimer);
    $('loaderTitle').textContent='Каталог найден: '+urls.length+' товаров';
    $('loaderSub').textContent='Сравниваю товары с Amazon партиями';
    const batchSize=6;
    for(let i=0;i<urls.length;i+=batchSize){
      const batch=urls.slice(i,i+batchSize);
      const r=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'analyze',urls:batch,marketplace:MARKET})});
      const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={products:[]}}
      const fresh=(data.products||[]).map(x=>({...x}));
      fresh.forEach(initModel);
      scanData.push(...fresh);
      const done=Math.min(i+batchSize,urls.length);
      $('loaderTitle').textContent='Проверено '+done+' из '+urls.length;
      $('loaderSub').textContent='Сверяю наличие, цены и считаю экономику';
      $('progressBar').style.width=Math.max(8,Math.round(done/urls.length*100))+'%';
      $('sourceInfo').textContent=(discovery.source?.host||url)+' · найдено '+urls.length+' · проверено '+done;
      renderSummary();renderScan();
    }
    $('sourceInfo').textContent=(discovery.source?.host||url)+' · каталог: '+urls.length+' товаров';
    stopLoading(true);
  }catch(e){
    scanData=[];renderSummary();
    $('scanResults').innerHTML='<div class="empty">Не удалось просканировать сайт: '+esc(e.message)+'</div>';
    $('sourceInfo').textContent='Ошибка сканирования сайта';
    stopLoading(false);
  }
}
$('scanBtn').onclick=fullSiteScan;
