const $=id=>document.getElementById(id), money=n=>new Intl.NumberFormat('ru-RU').format(Number(n||0)), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FIRST_ORDER_PROMO_CODE='FIRST10';
const FIRST_ORDER_PROMO_PERCENT=10;
let branches=[],products=[],cart=[],category='Все',paymentConfig={enabled:false},mapsConfig={enabled:false},verificationConfig={enabled:false},businessStatus={open:true,hours:'08:00–01:00'},params=new URLSearchParams(location.search),branchId=Number(params.get('branch')||0);
let deliveryMap=null,deliveryPlacemark=null,deliveryLat=null,deliveryLng=null,yandexReady=false,customer=null,authMode='login',telegramContext=null,telegramPollTimer=null;
let promoState={code:'',applied:false};
async function get(url,opts){const r=await fetch(url,opts);let d={};try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error||'Ошибка');e.status=r.status;throw e}return d}

function hideLoader(){
  const el=$('luxLoader');
  if(!el)return;
  el.classList.add('hide');
  setTimeout(()=>{ if(el && el.parentNode) el.remove(); },550);
}
window.addEventListener('load',()=>setTimeout(hideLoader,650));
setTimeout(hideLoader,4500);

let sliderIndex=0,sliderTimer=null;
function setupSlider(){
  const slides=[...document.querySelectorAll('#sliderTrack .slide')], dotsWrap=$('sliderDots');
  if(!slides.length||!dotsWrap)return;
  dotsWrap.innerHTML=slides.map((_,i)=>`<button type="button" data-slide="${i}" ${i===0?'class="active"':''} aria-label="Баннер ${i+1}"></button>`).join('');
  const dots=[...dotsWrap.querySelectorAll('button')];
  const show=i=>{
    sliderIndex=(i+slides.length)%slides.length;
    slides.forEach((s,n)=>s.classList.toggle('active',n===sliderIndex));
    dots.forEach((d,n)=>d.classList.toggle('active',n===sliderIndex));
  };
  const restart=()=>{if(sliderTimer)clearInterval(sliderTimer);sliderTimer=setInterval(()=>show(sliderIndex+1),4500)};
  $('prevSlide')?.addEventListener('click',()=>{show(sliderIndex-1);restart()});
  $('nextSlide')?.addEventListener('click',()=>{show(sliderIndex+1);restart()});
  dots.forEach((d,i)=>d.addEventListener('click',()=>{show(i);restart()}));
  show(0);restart();
}

function setupReveal(){
  const els=[...document.querySelectorAll('.reveal-up')];
  if(!els.length)return;
  if(!('IntersectionObserver' in window)){els.forEach(x=>x.classList.add('visible'));return}
  const obs=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target)}}),{threshold:.08});
  els.forEach(x=>obs.observe(x));
}

function renderPopularProducts(){
  const box=$('popularProducts');if(!box)return;
  const arr=products.slice(0,3);
  box.innerHTML=arr.length?arr.map((p,i)=>`<article class="popular-card"><div class="popular-photo">${p.image_url?`<img src="${p.image_url}" alt="${esc(p.name)}">`:`<span>${emoji(p.category)}</span>`}</div><div class="popular-body"><span class="popular-tag">🔥 Популярное</span><h4>${esc(p.name)}</h4><p>${i===0?'Один из любимых вариантов наших гостей.':i===1?'Отличный выбор для уютного кофейного настроения.':'Популярная позиция с красивой подачей.'}</p><div class="popular-bottom"><b>${money(p.price)} сум</b><button type="button" data-popular-add="${p.id}">В корзину</button></div></div></article>`).join(''):'<div class="empty">Популярные товары появятся после добавления меню.</div>';
  document.querySelectorAll('[data-popular-add]').forEach(b=>b.onclick=()=>add(Number(b.dataset.popularAdd)));
}
function renderBusinessStatus(){
  const box=$('businessStatus');if(!box)return;
  box.className='business-status '+(businessStatus.open?'open':'closed');
  box.innerHTML=`<span class="status-dot"></span><div><b>${businessStatus.open?'Открыто · онлайн-заказы принимаются':'Онлайн-заказы закрыты'}</b><small>Работаем ежедневно ${esc(businessStatus.hours||'08:00–01:00')}${businessStatus.localTime?` · сейчас ${esc(businessStatus.localTime)}`:''}</small></div>`;
  const send=$('sendOrder');if(send){send.disabled=!businessStatus.open;send.textContent=businessStatus.open?'Оформить заказ':'Онлайн-заказ закрыт до 08:00'}
}
async function refreshBusinessStatus(){try{businessStatus=await get('/api/public/business-status');renderBusinessStatus()}catch{businessStatus={open:true,hours:'08:00–01:00'};renderBusinessStatus()}}

async function loadCustomer(){try{const d=await get('/api/customer/me');customer=d.customer}catch{customer=null}syncPromoState();renderCustomerState()}
function promoEligible(){return Boolean(customer?.first_order_eligible)}
function normalizePromoCode(value){return String(value||'').trim().toUpperCase()}
function currentSubtotal(){return cart.reduce((s,x)=>s+x.price*x.quantity,0)}
function currentDiscount(){return promoState.applied&&promoEligible()&&promoState.code===FIRST_ORDER_PROMO_CODE?Math.round(currentSubtotal()*FIRST_ORDER_PROMO_PERCENT/100):0}
function syncPromoState(){if(promoState.code)promoState.code=normalizePromoCode(promoState.code);if(!promoEligible()||promoState.code!==FIRST_ORDER_PROMO_CODE)promoState.applied=false;const input=$('promoCode');if(input&&promoState.code&&input.value!==promoState.code)input.value=promoState.code}
function setPromoStatus(text,kind='info'){const el=$('promoStatus');if(!el)return;el.textContent=text;el.className='promo-status '+kind}
function applyPromoCode(){const code=normalizePromoCode($('promoCode').value);promoState.code=code;promoState.applied=false;if(!code){setPromoStatus('Введите промокод для скидки на первый заказ.','info');renderCart();return}if(code!==FIRST_ORDER_PROMO_CODE){setPromoStatus('Такого промокода нет. Используйте FIRST10.','error');renderCart();return}if(!customer){setPromoStatus('Сначала войдите в аккаунт клиента, чтобы использовать FIRST10.','warn');renderCart();return}if(!promoEligible()){setPromoStatus('FIRST10 действует только на первый онлайн-заказ.','warn');renderCart();return}promoState.applied=true;setPromoStatus(`Промокод FIRST10 применён: −${FIRST_ORDER_PROMO_PERCENT}% на первый заказ.`, 'success');renderCart();}
function renderCustomerState(){
  $('accountBtn').textContent=customer?`👤 ${customer.name}`:'Войти';
  syncPromoState();
  if(customer){
    const verified=Boolean(customer.phone_verified);
    $('checkoutAccount').innerHTML=`<div class="account-ok ${verified?'verified':'unverified'}"><b>👤 ${esc(customer.name)}</b><small>${esc(customer.phone)} · ${verified?'✅ подтверждён':'⚠️ не подтверждён'}</small>${verified?'':`<button id="checkoutVerify" type="button">Подтвердить через Telegram</button>`}</div>`;
    $('checkoutVerify')?.addEventListener('click',()=>startExistingVerification());
  }else{
    $('checkoutAccount').innerHTML=`<div class="account-needed"><b>Войдите или зарегистрируйтесь</b><small>Для заказа нужен подтверждённый номер телефона.</small><button id="checkoutLogin" type="button">Войти / регистрация</button></div>`;
    $('checkoutLogin')?.addEventListener('click',()=>openAuth('login'));
  }
}
async function init(){
  const [b,pay,maps,verification,hours]=await Promise.all([get('/api/public/branches'),get('/api/public/payment-config'),get('/api/public/maps-config'),get('/api/public/verification-config'),get('/api/public/business-status')]);branches=b;paymentConfig=pay;mapsConfig=maps;verificationConfig=verification;businessStatus=hours;renderBusinessStatus();setInterval(refreshBusinessStatus,60000);
  await loadCustomer();
  if(!branchId||!branches.some(b=>Number(b.id)===branchId))branchId=Number(branches[0]?.id||0);
  $('branchSelect').innerHTML=branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$('branchSelect').value=branchId;
  $('branchSelect').onchange=()=>{branchId=Number($('branchSelect').value);history.replaceState(null,'',`?branch=${branchId}`);loadProducts()};
  $('receiptOption').classList.remove('hide');$('transferCardNumber').textContent=paymentConfig.cardNumber||'Карта ещё не настроена';$('transferCardHolder').textContent=paymentConfig.cardHolder?`Получатель: ${paymentConfig.cardHolder}`:(paymentConfig.enabled?'':'Администратор должен сохранить карту в разделе «QR и меню»');setupDeliveryControls();setupPaymentControls();setupAccountControls();
  if(mapsConfig.enabled)loadYandexMaps().then(()=>{if(document.querySelector('input[name="deliveryType"]:checked')?.value==='delivery')initDeliveryMap()}).catch(()=>{$('mapHint').textContent='Не удалось загрузить Яндекс Карту. Адрес можно ввести вручную.'});
  else $('mapHint').textContent='Карта пока не подключена. Адрес можно ввести вручную.';
  await loadProducts();setupSlider();setupReveal();hideLoader();const returnedOrder=Number(params.get('payment_order')||0);if(returnedOrder&&customer)await showPaymentResult(returnedOrder)
}
async function loadProducts(){products=await get('/api/public/products?branch='+branchId);$('branchName').textContent=branches.find(b=>Number(b.id)===branchId)?.name||'In coffee';renderCats();renderProducts();renderPopularProducts();renderCart()}
function renderCats(){const cats=['Все',...new Set(products.map(p=>p.category))];$('categories').innerHTML=cats.map(c=>`<button class="chip ${c===category?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{category=b.dataset.cat;renderCats();renderProducts()})}
function emoji(cat){return /дес/i.test(cat)?'🍰':/напит|мох/i.test(cat)?'🥤':'☕'}
function renderProducts(){const arr=category==='Все'?products:products.filter(p=>p.category===category);$('products').innerHTML=arr.length?arr.map(p=>`<div class="menu-item"><div class="menu-photo ${p.image_url?'has-photo':''}">${p.image_url?`<img src="${p.image_url}" alt="${esc(p.name)}">`:`<span>${emoji(p.category)}</span>`}</div><h3>${esc(p.name)}</h3><small>${esc(p.category)}</small><footer><b>${money(p.price)} сум</b><button data-add="${p.id}">+</button></footer></div>`).join(''):'<div class="empty">Нет товаров</div>';document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(Number(b.dataset.add)))}
function add(id){const p=products.find(x=>Number(x.id)===id);const f=cart.find(x=>x.productId===id);if(f)f.quantity++;else cart.push({productId:id,name:p.name,price:Number(p.price),quantity:1});renderCart()}
function renderCart(){const subtotal=currentSubtotal(),discount=currentDiscount(),total=Math.max(0,subtotal-discount),count=cart.reduce((s,x)=>s+x.quantity,0);$('total').textContent=money(total);$('drawerSubtotal').textContent=money(subtotal);$('drawerDiscount').textContent=money(discount);$('drawerTotal').textContent=money(total);$('count').textContent=count;$('discountRow').classList.toggle('hide',!discount);$('promoAppliedCode').textContent=promoState.code||FIRST_ORDER_PROMO_CODE;$('cartList').innerHTML=cart.length?cart.map(x=>`<div class="cart-row"><div><b>${esc(x.name)}</b><br><small>${money(x.price)} сум</small></div><div class="cart-actions"><button onclick="change(${x.productId},-1)">−</button><b>${x.quantity}</b><button onclick="change(${x.productId},1)">+</button></div></div>`).join(''):'<div class="empty">Корзина пуста</div>';if(!cart.length&&$('promoCode').value&&!promoState.applied){setPromoStatus('Добавьте товары в корзину, затем примените промокод.','info')}else if(!promoState.code){setPromoStatus(customer?(promoEligible()?'Введите FIRST10 и получите 10% скидку на первый заказ.':'Промокод FIRST10 доступен только на первый заказ.'):'Войдите в аккаунт клиента, чтобы использовать промокод на первый заказ.','info')}renderCustomerState()}
window.change=(id,d)=>{const x=cart.find(i=>i.productId===id);if(!x)return;x.quantity+=d;if(x.quantity<=0)cart=cart.filter(i=>i.productId!==id);renderCart()};
$('openCart').onclick=()=>$('drawer').classList.remove('hide');$('closeCart').onclick=()=>$('drawer').classList.add('hide');$('drawer').onclick=e=>{if(e.target===$('drawer'))$('drawer').classList.add('hide')};
$('applyPromo').onclick=applyPromoCode;$('promoCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyPromoCode()}});
$('sendOrder').onclick=async()=>{
  if(!businessStatus.open)return alert('Онлайн-заказы принимаются с 08:00 до 01:00');
  if(!cart.length)return alert('Добавьте товары');if(!customer){openAuth('register');return}if(!customer.phone_verified){await startExistingVerification();return}
  const paymentMethod='receipt',deliveryType='delivery',deliveryAddress=$('deliveryAddress').value.trim(),deliveryComment=$('deliveryComment').value.trim();
  if(deliveryType==='delivery'&&!deliveryAddress)return alert('Укажите адрес доставки');
  if(!paymentConfig.enabled)return alert('Оплата переводом пока не настроена');
  if(paymentMethod!=='receipt')return alert('Для онлайн-заказа доступна только оплата переводом на карту');
  if(!$('paymentReceipt').files[0])return alert('Загрузите чек оплаты');
  $('sendOrder').disabled=true;
  try{
    let options;
    const orderData={branchId,paymentMethod,deliveryType,deliveryAddress,deliveryLat,deliveryLng,deliveryComment,promoCode:promoState.applied?promoState.code:'',items:cart.map(({productId,quantity})=>({productId,quantity}))};
    const fd=new FormData();for(const [k,v] of Object.entries(orderData)){fd.append(k,k==='items'?JSON.stringify(v):v??'')}fd.append('receipt',$('paymentReceipt').files[0]);options={method:'POST',body:fd};
    const d=await get('/api/public/orders',options);$('drawer').classList.add('hide');const deliveryText=` Доставка: ${deliveryAddress}.`;const promoText=d.order.discount_amount?` Промокод ${d.order.promo_code} применён: скидка ${money(d.order.discount_amount)} сум.`:'';
    $('successText').textContent=`Заказ №${d.order.id}. Чек отправлен на проверку. Сумма: ${money(d.order.total)} сум.${promoText}${deliveryText}`;
    $('success').classList.remove('hide');cart=[];$('paymentReceipt').value='';promoState={code:'',applied:false};if(customer)customer.first_order_eligible=false;renderCart()
  }catch(e){if(e.status===401){customer=null;renderCustomerState();openAuth('login')}else alert(e.message)}finally{$('sendOrder').disabled=false}
};
function setupAccountControls(){
  $('accountBtn').onclick=()=>customer?openProfile():openAuth('login');$('closeAuth').onclick=()=>closeModal('authModal');$('closeProfile').onclick=()=>closeModal('profileModal');
  $('loginTab').onclick=()=>setAuthMode('login');$('registerTab').onclick=()=>setAuthMode('register');$('authSubmit').onclick=submitAuth;$('telegramCheck').onclick=checkTelegramVerification;$('telegramRestart').onclick=restartTelegramVerification;$('backAuth').onclick=()=>showAuthForm();
  $('authPassword').onkeydown=e=>{if(e.key==='Enter')submitAuth()};$('saveProfile').onclick=saveProfile;$('logoutCustomer').onclick=logoutCustomer;$('changePassword').onclick=changeCustomerPassword;$('verifyPhone').onclick=startExistingVerification;
  $('authModal').onclick=e=>{if(e.target===$('authModal'))closeModal('authModal')};$('profileModal').onclick=e=>{if(e.target===$('profileModal'))closeModal('profileModal')};$('successDone').onclick=()=>{$('success').classList.add('hide');if(customer)openProfile()}
}
function openAuth(mode='login'){setAuthMode(mode);showAuthForm();$('authError').textContent='';$('authModal').classList.remove('hide');setTimeout(()=>$(mode==='register'?'authName':'authPhone').focus(),50)}
function setAuthMode(mode){authMode=mode;const reg=mode==='register';$('loginTab').classList.toggle('active',!reg);$('registerTab').classList.toggle('active',reg);$('authName').classList.toggle('hide',!reg);$('authTitle').textContent=reg?'Регистрация':'Вход';$('authSubmit').textContent=reg?'Продолжить через Telegram':'Войти';$('authError').textContent=''}
function stopTelegramPoll(){if(telegramPollTimer){clearInterval(telegramPollTimer);telegramPollTimer=null}}
function showAuthForm(){stopTelegramPoll();$('authFormStep').classList.remove('hide');$('telegramStep').classList.add('hide');telegramContext=null;$('authError').textContent=''}
function showTelegramStep(context,phone,data,message){stopTelegramPoll();telegramContext={...context,phone,token:data.token,telegramUrl:data.telegramUrl};$('authFormStep').classList.add('hide');$('telegramStep').classList.remove('hide');$('authTitle').textContent='Telegram-подтверждение';$('telegramText').textContent=message||`Подтвердите номер ${phone} через Telegram.`;$('telegramOpen').href=data.telegramUrl;$('authError').textContent='';telegramPollTimer=setInterval(()=>checkTelegramVerification(true),2500)}
function closeModal(id){if(id==='authModal')stopTelegramPoll();$(id).classList.add('hide')}
async function submitAuth(){const name=$('authName').value.trim(),phone=$('authPhone').value.trim(),password=$('authPassword').value;$('authSubmit').disabled=true;$('authError').textContent='';try{if(authMode==='register'){if(!verificationConfig.enabled)throw new Error('Подтверждение через Telegram ещё не подключено администратором');const d=await get('/api/customer/register/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone,password})});showTelegramStep({purpose:'register',name,password},phone,d,`Откройте Telegram и поделитесь своим номером ${d.phoneMasked||phone}. Ссылка действует 10 минут.`);return}const d=await get('/api/customer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password})});customer=d.customer;$('authPassword').value='';renderCustomerState();if(!customer.phone_verified){await startExistingVerification(true);return}closeModal('authModal');if(!$('drawer').classList.contains('hide'))return;openProfile()}catch(e){$('authError').textContent=e.message}finally{$('authSubmit').disabled=false}}
async function startExistingVerification(keepModal=false){if(!customer)return openAuth('login');if(customer.phone_verified)return;try{const d=await get('/api/customer/verification/send',{method:'POST'});if(!keepModal)$('authModal').classList.remove('hide');showTelegramStep({purpose:'verify_existing'},customer.phone,d,`Откройте Telegram и подтвердите номер ${d.phoneMasked||customer.phone}. После этого можно оформлять заказы.`)}catch(e){if(!keepModal)$('authModal').classList.remove('hide');$('authError').textContent=e.message}}
async function checkTelegramVerification(silent=false){if(!telegramContext)return;try{const url=telegramContext.purpose==='register'?`/api/customer/register/status?token=${encodeURIComponent(telegramContext.token)}`:`/api/customer/verification/status?token=${encodeURIComponent(telegramContext.token)}`;const d=await get(url);if(!d.verified){if(!silent)$('authError').textContent='В Telegram ещё не подтверждено. Нажмите кнопку у бота.';return}customer=d.customer;stopTelegramPoll();closeModal('authModal');$('authPassword').value='';syncPromoState();renderCustomerState();if(!$('drawer').classList.contains('hide'))return;openProfile()}catch(e){if(!silent)$('authError').textContent=e.message}}
async function restartTelegramVerification(){if(!telegramContext)return;stopTelegramPoll();$('authError').textContent='';try{let d;if(telegramContext.purpose==='register'){d=await get('/api/customer/register/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:telegramContext.name,phone:telegramContext.phone,password:telegramContext.password})})}else{d=await get('/api/customer/verification/send',{method:'POST'})}showTelegramStep(telegramContext,telegramContext.phone,d,'Создана новая ссылка. Откройте Telegram и поделитесь своим номером.')}catch(e){$('authError').textContent=e.message}}
async function openProfile(){if(!customer)return openAuth('login');$('profileName').value=customer.name;$('profilePhone').textContent=customer.phone;$('profileVerified').textContent=customer.phone_verified?'✅ Номер подтверждён':'⚠️ Номер не подтверждён';$('profileVerified').className='verify-badge '+(customer.phone_verified?'ok':'warn');$('verifyPhone').classList.toggle('hide',Boolean(customer.phone_verified));$('profileModal').classList.remove('hide');await loadHistory()}
async function saveProfile(){const name=$('profileName').value.trim();try{const d=await get('/api/customer/me',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});customer=d.customer;syncPromoState();renderCustomerState();alert('Имя сохранено')}catch(e){alert(e.message)}}
async function logoutCustomer(){await get('/api/customer/logout',{method:'POST'});customer=null;promoState={code:'',applied:false};closeModal('profileModal');renderCustomerState();renderCart()}
async function changeCustomerPassword(){const currentPassword=prompt('Текущий пароль:');if(currentPassword===null)return;const newPassword=prompt('Новый пароль (минимум 8 символов):');if(newPassword===null)return;try{await get('/api/customer/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword,newPassword})});alert('Пароль изменён')}catch(e){alert(e.message)}}
function statusText(v){return({new:'Новый',accepted:'Принят',ready:'Готов',completed:'Выполнен',cancelled:'Отменён'})[v]||v}
function payText(o){if(o.payment_status==='paid')return '✅ Оплачено';if(o.payment_status==='review')return '🧾 Чек на проверке';if(o.payment_status==='rejected')return '❌ Чек отклонён';if(o.payment_status==='pending')return '⏳ Ожидает оплаты';if(o.payment_status==='cancelled')return '❌ Платёж отменён';return o.payment_method==='receipt'?'Чек не подтверждён':o.payment_method==='payme'?'Не оплачено':'Оплата при получении'}
async function loadHistory(){const box=$('historyList');box.innerHTML='<div class="empty">Загрузка…</div>';try{const orders=await get('/api/customer/orders');box.innerHTML=orders.length?orders.map(o=>`<div class="history-card"><div class="history-top"><div><b>Заказ №${o.id}</b><small>${new Date(o.created_at).toLocaleString('ru-RU')}</small></div><strong>${money(o.total)} сум</strong></div><div class="history-badges"><span>${statusText(o.status)}</span><span class="${o.payment_status==='paid'?'paid':''}">${payText(o)}</span></div>${o.discount_amount?`<div class="history-discount">🎁 ${esc(o.promo_code||'FIRST10')} · скидка ${money(o.discount_amount)} сум</div>`:''}<div class="history-items">${o.items.map(i=>`${esc(i.name_snapshot)} × ${i.quantity}`).join('<br>')}</div><small>${esc(o.branch_name||'In coffee')} · Доставка${o.delivery_address?` · ${esc(o.delivery_address)}`:''}</small></div>`).join(''):'<div class="empty">Заказов пока нет</div>'}catch(e){if(e.status===401){customer=null;closeModal('profileModal');renderCustomerState();openAuth('login')}else box.innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
function setupPaymentControls(){$('receiptPaymentBox').classList.remove('hide');}
function setupDeliveryControls(){$('deliveryBox').classList.remove('hide');$('findAddress').onclick=findAddressOnMap;$('myLocation').onclick=useMyLocation;if(yandexReady&&!deliveryMap)initDeliveryMap()}
function loadYandexMaps(){return new Promise((resolve,reject)=>{if(window.ymaps){window.ymaps.ready(()=>{yandexReady=true;resolve()});return}const script=document.createElement('script');script.src=`https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(mapsConfig.apiKey)}&lang=ru_RU`;script.async=true;script.onload=()=>window.ymaps.ready(()=>{yandexReady=true;resolve()});script.onerror=reject;document.head.appendChild(script)})}
function initDeliveryMap(center=[41.3775,64.5853],zoom=6){if(!yandexReady||deliveryMap)return;$('mapPlaceholder')?.remove();deliveryMap=new ymaps.Map('deliveryMap',{center,zoom,controls:['zoomControl','geolocationControl']});deliveryMap.events.add('click',e=>setDeliveryPoint(e.get('coords'),true))}
async function setDeliveryPoint(coords,reverse=false){deliveryLat=Number(coords[0]);deliveryLng=Number(coords[1]);if(!deliveryMap)initDeliveryMap(coords,16);if(deliveryPlacemark)deliveryPlacemark.geometry.setCoordinates(coords);else{deliveryPlacemark=new ymaps.Placemark(coords,{hintContent:'Точка доставки'},{draggable:true,preset:'islands#redDotIcon'});deliveryPlacemark.events.add('dragend',()=>setDeliveryPoint(deliveryPlacemark.geometry.getCoordinates(),true));deliveryMap.geoObjects.add(deliveryPlacemark)}deliveryMap.setCenter(coords,16,{checkZoomRange:true});$('mapHint').textContent=`Точка выбрана: ${deliveryLat.toFixed(6)}, ${deliveryLng.toFixed(6)}`;if(reverse&&window.ymaps){try{const r=await ymaps.geocode(coords,{results:1}),first=r.geoObjects.get(0),line=first?.getAddressLine?.()||first?.properties?.get('text');if(line)$('deliveryAddress').value=line}catch{}}}
async function findAddressOnMap(){const q=$('deliveryAddress').value.trim();if(!q)return alert('Сначала введите адрес');if(!yandexReady)return alert('Яндекс Карта пока не подключена. Адрес сохранится текстом.');if(!deliveryMap)initDeliveryMap();try{const r=await ymaps.geocode(q,{results:1}),first=r.geoObjects.get(0);if(!first)return alert('Адрес не найден');await setDeliveryPoint(first.geometry.getCoordinates(),false)}catch{alert('Не удалось найти адрес')}}
function useMyLocation(){if(!navigator.geolocation)return alert('Геолокация не поддерживается этим браузером');$('mapHint').textContent='Определяем местоположение…';navigator.geolocation.getCurrentPosition(async pos=>{const coords=[pos.coords.latitude,pos.coords.longitude];if(yandexReady){if(!deliveryMap)initDeliveryMap(coords,16);await setDeliveryPoint(coords,true)}else{deliveryLat=coords[0];deliveryLng=coords[1];$('mapHint').textContent=`Местоположение сохранено: ${deliveryLat.toFixed(6)}, ${deliveryLng.toFixed(6)}`}},()=>alert('Не удалось получить местоположение.'),{enableHighAccuracy:true,timeout:10000,maximumAge:60000})}
async function showPaymentResult(orderId){try{const o=await get('/api/public/order-payment/'+orderId);$('successText').textContent=o.payment_status==='paid'?`Заказ №${o.id} оплачен через Payme. Сумма: ${money(o.total)} сум.`:`Заказ №${o.id}. Статус оплаты: ${payText(o)}.`;$('success').classList.remove('hide')}catch{}}
init().then(hideLoader).catch(e=>{hideLoader();document.body.innerHTML=`<div class="empty">${esc(e.message)}</div>`});