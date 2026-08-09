const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('ru-RU').format(Number(n || 0));
const fmtDate = d => new Date(d).toLocaleString('ru-RU');
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pack = o => encodeURIComponent(JSON.stringify(o)).replace(/'/g,'%27');
const unpack = s => JSON.parse(decodeURIComponent(s));

const state = { user:null, branches:[], branchId:null, products:[], cart:[], page:'dashboard' };

function toast(text, bad=false){
  const el=$('toast'); el.textContent=text; el.className='toast show'+(bad?' error-toast':'');
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.className='toast',2600);
}
async function api(url, opts={}){
  opts.headers={...(opts.headers||{})};
  if(state.branchId) opts.headers['X-Branch-Id']=state.branchId;
  if(opts.body && typeof opts.body!=='string'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(opts.body)}
  const r=await fetch(url,opts); let d={}; try{d=await r.json()}catch{}
  if(r.status===401 && url!=='/api/login'){showLogin(); throw new Error('Сессия истекла')}
  if(!r.ok) throw new Error(d.error||'Ошибка');
  return d;
}
async function prepareImage(file){
  if(!file)return null;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Поддерживаются JPG, PNG и WebP');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('Не удалось открыть фото'));el.src=url});
    const max=1200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось обработать фото')),'image/jpeg',0.84));
  }finally{URL.revokeObjectURL(url)}
}
async function uploadProductImage(id,file){
  if(!file)return;
  const blob=await prepareImage(file);const form=new FormData();form.append('image',blob,`product-${id}.jpg`);
  const headers={};if(state.branchId)headers['X-Branch-Id']=state.branchId;
  const r=await fetch(`/api/products/${id}/image`,{method:'POST',headers,body:form});let d={};try{d=await r.json()}catch{};if(!r.ok)throw new Error(d.error||'Не удалось загрузить фото');return d;
}
function showLogin(){ $('app').classList.add('hide'); $('login').classList.remove('hide'); }
function showApp(){ $('login').classList.add('hide'); $('app').classList.remove('hide'); }

function roleName(r){return r==='owner'?'Владелец':r==='admin'?'Администратор':'Кассир'}
function canAdmin(){return state.user && ['owner','admin'].includes(state.user.role)}
function setRoleUi(){
  document.querySelectorAll('#nav button[data-roles]').forEach(b=>b.classList.toggle('hide',!b.dataset.roles.split(',').includes(state.user.role)));
  document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hide',!canAdmin()));
  $('sidebarUser').innerHTML=`<b>${esc(state.user.name)}</b>${roleName(state.user.role)}`;
}
function setupBranches(){
  const select=$('branchSelect');
  select.innerHTML=state.branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
  if(state.user.role!=='owner' && state.user.branchId){state.branchId=Number(state.user.branchId);select.value=state.branchId;select.disabled=true}
  else {state.branchId=Number(localStorage.getItem('inCoffeeBranch')||state.branches[0]?.id||0); if(!state.branches.some(b=>Number(b.id)===state.branchId))state.branchId=Number(state.branches[0]?.id||0); select.value=state.branchId;select.disabled=false}
  select.onchange=()=>{state.branchId=Number(select.value);localStorage.setItem('inCoffeeBranch',state.branchId);loadPage(state.page)};
  $('userBranch').innerHTML=state.branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');
}

async function login(){
  $('loginError').textContent='';
  try{
    await api('/api/login',{method:'POST',body:{username:$('loginUser').value.trim(),password:$('loginPassword').value}});
    await bootstrap();
  }catch(e){$('loginError').textContent=e.message}
}
$('loginBtn').onclick=login;
$('loginPassword').onkeydown=e=>{if(e.key==='Enter')login()};
$('logoutBtn').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{} location.reload()};

async function bootstrap(){
  const d=await api('/api/me'); state.user=d.user;state.branches=d.branches;setupBranches();setRoleUi();showApp();go('dashboard');
}

const titles={dashboard:['Главная','Обзор кофейни'],cash:['Касса','Продажи и оплата'],orders:['Онлайн-заказы','Заказы клиентов'],products:['Товары','Меню и цены'],warehouse:['Склад','Остатки'],recipes:['Рецепты','Автосписание'],reports:['Отчёты','Продажи и прибыль'],receipts:['Чеки','История продаж'],expenses:['Расходы','История расходов'],customers:['QR и меню','Меню для клиентов'],users:['Сотрудники','Роли и доступ'],branches:['Филиалы','Управление точками'],settings:['Настройки','Безопасность']};
function go(page){
  const btn=document.querySelector(`#nav button[data-page="${page}"]`); if(btn?.classList.contains('hide'))page='dashboard';
  state.page=page; document.querySelectorAll('.page').forEach(p=>p.classList.add('hide')); $(`page-${page}`).classList.remove('hide');
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('topTitle').textContent=titles[page][0];$('topSubtitle').textContent=titles[page][1]; closeMenu(); loadPage(page);
}
document.querySelectorAll('#nav button[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>go(b.dataset.goto));

function openMenu(){$('sidebar').classList.add('open');$('overlay').classList.add('show')}
function closeMenu(){$('sidebar').classList.remove('open');$('overlay').classList.remove('show')}
$('menuBtn').onclick=()=>$('sidebar').classList.contains('open')?closeMenu():openMenu(); $('overlay').onclick=closeMenu;

async function loadPage(page){
  try{
    if(page==='dashboard')await dashboard();
    if(page==='cash')await loadProducts();
    if(page==='orders')await orders();
    if(page==='products')await productsAdmin();
    if(page==='warehouse')await warehouse();
    if(page==='recipes')await recipes();
    if(page==='reports')await reports();
    if(page==='receipts')await receipts();
    if(page==='expenses')await expenses();
    if(page==='customers')await customerQr();
    if(page==='users')await users();
    if(page==='branches')await branches();
  }catch(e){toast(e.message,true)}
}

function activityRow(o){
  const isOut=o.type==='cash_out'; const label=o.type==='sale'?`Продажа · ${o.method==='cash'?'наличные':o.method==='card'?'карта':'онлайн'}`:o.type==='cash_in'?'Внесение':`Расход${o.reason?' · '+o.reason:''}`;
  return `<div class="list-row"><div class="list-main"><b>${esc(label)}</b><small>${fmtDate(o.created_at)}${o.user_name?' · '+esc(o.user_name):''}</small></div><strong class="${isOut?'amount-minus':'amount-plus'}">${isOut?'−':'+'}${money(o.amount)} сум</strong></div>`;
}
async function dashboard(){
  const d=await api('/api/dashboard');
  $('dashCash').textContent=money(d.cash)+' сум';$('dashSales').textContent=money(d.sales)+' сум';$('dashExpenses').textContent=money(d.expenses)+' сум';$('dashLow').textContent=d.low_stock;
  $('activityList').innerHTML=d.activity.length?d.activity.map(activityRow).join(''):'<div class="empty">Операций пока нет</div>';
  $('ordersBadge').textContent=d.pending_orders;$('ordersBadge').classList.toggle('hide',!Number(d.pending_orders));
  $('stockBadge').textContent=d.low_stock;$('stockBadge').classList.toggle('hide',!Number(d.low_stock));
}

async function loadProducts(){state.products=await api('/api/products');renderProducts();renderCart()}
function renderProducts(){
  const q=$('productSearch').value.trim().toLowerCase(); const arr=state.products.filter(p=>!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q));
  $('posProducts').innerHTML=arr.length?arr.map(p=>`<button class="product-card" data-product="${p.id}"><div class="product-thumb ${p.image_url?'has-image':''}">${p.image_url?`<img src="${p.image_url}" alt="${esc(p.name)}">`:'☕'}</div><b>${esc(p.name)}</b><small>${esc(p.category)}</small><span>${money(p.price)} сум</span></button>`).join(''):'<div class="empty">Ничего не найдено</div>';
  document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>addCart(Number(b.dataset.product)));
}
$('productSearch').oninput=renderProducts;
function addCart(id){const p=state.products.find(x=>Number(x.id)===id);if(!p)return;const f=state.cart.find(x=>x.productId===id);if(f)f.quantity++;else state.cart.push({productId:id,name:p.name,price:Number(p.price),quantity:1});renderCart()}
function cartTotal(){return state.cart.reduce((s,x)=>s+x.price*x.quantity,0)}
function renderCart(){
  $('cartCount').textContent=state.cart.reduce((s,x)=>s+x.quantity,0);$('cartTotal').textContent=money(cartTotal());
  $('cartList').innerHTML=state.cart.length?state.cart.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.name)}</b><small>${x.quantity} × ${money(x.price)} сум</small></div><div class="row-actions"><button class="mini" onclick="cartChange(${x.productId},-1)">−</button><button class="mini" onclick="cartChange(${x.productId},1)">+</button><button class="mini red" onclick="cartRemove(${x.productId})">Удалить</button></div></div>`).join(''):'<div class="empty">Чек пуст</div>';
}
window.cartChange=(id,d)=>{const x=state.cart.find(i=>i.productId===id);if(!x)return;x.quantity+=d;if(x.quantity<=0)state.cart=state.cart.filter(i=>i.productId!==id);renderCart()};
window.cartRemove=id=>{state.cart=state.cart.filter(i=>i.productId!==id);renderCart()};
$('clearCart').onclick=()=>{state.cart=[];renderCart()};
async function pay(method){if(!state.cart.length)return toast('Добавь товар в чек',true);try{const d=await api('/api/sale',{method:'POST',body:{method,items:state.cart.map(({productId,quantity})=>({productId,quantity}))}});state.cart=[];renderCart();toast(`Продажа №${d.sale.id} на ${money(d.sale.total)} сум`);dashboard()}catch(e){toast(e.message,true)}}
$('cashPay').onclick=()=>pay('cash');$('cardPay').onclick=()=>pay('card');
$('cashIn').onclick=async()=>{const amount=Number(prompt('Сколько внести в кассу?'));if(!amount)return;try{await api('/api/cash',{method:'POST',body:{type:'cash_in',amount}});toast('Деньги внесены');dashboard()}catch(e){toast(e.message,true)}};
$('cashOut').onclick=async()=>{const amount=Number(prompt('Сколько изъять?'));if(!amount)return;const reason=prompt('Причина расхода:');if(!reason?.trim())return;try{await api('/api/cash',{method:'POST',body:{type:'cash_out',amount,reason:reason.trim()}});toast('Расход сохранён');dashboard()}catch(e){toast(e.message,true)}};

const statusNames={new:'Новый',accepted:'Принят',ready:'Готов',completed:'Завершён',cancelled:'Отменён'};
const paymentNames={cash:'При получении',payme:'Payme'}; const paymentStatusNames={unpaid:'Не оплачено',pending:'Ожидание оплаты',paid:'Оплачено',cancelled:'Отменено'};
async function orders(){const arr=await api('/api/orders');$('ordersList').innerHTML=arr.length?arr.map(o=>`<div class="order-card ${o.status}"><div class="list-row"><div class="list-main"><b>Заказ №${o.id} · ${esc(o.customer_name)}</b><small>${esc(o.customer_phone)} · ${fmtDate(o.created_at)} · ${paymentNames[o.payment_method]||esc(o.payment_method)} · ${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</small>${o.delivery_type==='delivery'?`<small>🚗 Доставка · ${esc(o.delivery_address||'Адрес не указан')}</small>`:'<small>🏪 Самовывоз</small>'}</div><div class="row-actions"><span class="status ${o.payment_status==='paid'?'ready':o.payment_status==='pending'?'accepted':''}">${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</span><span class="status ${o.status}">${statusNames[o.status]}</span><strong>${money(o.total)} сум</strong><button class="mini" onclick="openOrder(${o.id})">Открыть</button></div></div></div>`).join(''):'<div class="empty">Онлайн-заказов пока нет</div>';dashboard()}
$('refreshOrders').onclick=orders;
window.openOrder=async id=>{try{const o=await api('/api/orders/'+id);const paid=o.payment_method==='payme'&&o.payment_status==='paid';const delivery=o.delivery_type==='delivery';const mapUrl=deliveryMapLink(o);openModal(`<div class="modal-head"><h2>Заказ №${o.id}</h2><button class="modal-close" onclick="closeModal()">×</button></div><p><b>${esc(o.customer_name)}</b><br>${esc(o.customer_phone)}</p><p class="muted">Оплата: ${paymentNames[o.payment_method]||esc(o.payment_method)} · <b>${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</b></p>${delivery?`<div class="delivery-info"><b>🚗 Доставка</b><p>${esc(o.delivery_address||'Адрес не указан')}</p>${o.delivery_comment?`<p class="muted">Комментарий: ${esc(o.delivery_comment)}</p>`:''}${mapUrl?`<a class="btn secondary" href="${mapUrl}" target="_blank" rel="noopener">📍 Открыть в Яндекс Картах</a>`:''}</div>`:'<p><b>🏪 Самовывоз</b></p>'}<div class="list">${o.items.map(x=>`<div class="list-row"><span>${esc(x.name)} × ${x.quantity}</span><b>${money(x.price*x.quantity)} сум</b></div>`).join('')}</div><h3>Итого: ${money(o.total)} сум</h3><div class="actions">${o.status==='new'?`<button class="btn primary" onclick="orderStatus(${o.id},'accepted')">Принять</button>`:''}${['new','accepted'].includes(o.status)?`<button class="btn success" onclick="orderStatus(${o.id},'ready')">Готов</button>`:''}${o.status==='ready'?(paid?`<button class="btn success" onclick="completeOrder(${o.id},'online')">✅ Выдать оплаченный заказ</button>`:`<button class="btn success" onclick="completeOrder(${o.id},'cash')">💵 Выдать за наличные</button><button class="btn primary" onclick="completeOrder(${o.id},'card')">💳 Выдать по карте</button>`):''}${!['completed','cancelled'].includes(o.status)?`<button class="btn danger" onclick="orderStatus(${o.id},'cancelled')">Отменить</button>`:''}</div>`)}catch(e){toast(e.message,true)}};
function deliveryMapLink(o){if(o.delivery_lat!=null&&o.delivery_lng!=null){const lat=Number(o.delivery_lat),lng=Number(o.delivery_lng);if(Number.isFinite(lat)&&Number.isFinite(lng))return `https://yandex.com/maps/?pt=${encodeURIComponent(lng+','+lat)}&z=17&l=map`}if(o.delivery_address)return `https://yandex.com/maps/?text=${encodeURIComponent(o.delivery_address)}`;return ''}
window.orderStatus=async(id,status)=>{try{await api(`/api/orders/${id}/status`,{method:'PUT',body:{status}});closeModal();toast('Статус обновлён');orders()}catch(e){toast(e.message,true)}};
window.completeOrder=async(id,paymentMethod)=>{try{await api(`/api/orders/${id}/status`,{method:'PUT',body:{status:'completed',paymentMethod}});closeModal();toast('Заказ выдан и добавлен в продажи');orders()}catch(e){toast(e.message,true)}};

async function productsAdmin(){const arr=await api('/api/products/all');$('productsList').innerHTML=arr.length?arr.map(p=>`<div class="list-row product-admin-row"><div class="product-admin-info">${p.image_url?`<img src="${p.image_url}" alt="${esc(p.name)}">`:`<div class="product-fallback">☕</div>`}<div class="list-main"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${money(p.price)} сум · ${p.active?'Активен':'Скрыт'}</small></div></div><div class="row-actions"><button class="mini" onclick="editProduct('${pack(p)}')">Изменить</button></div></div>`).join(''):'<div class="empty">Нет товаров</div>'}
$('addProduct').onclick=async()=>{try{const d=await api('/api/products',{method:'POST',body:{name:$('productName').value.trim(),category:$('productCategory').value.trim()||'Кофе',price:Number($('productPrice').value)}});const file=$('productImage').files[0];if(file)await uploadProductImage(d.product.id,file);$('productName').value='';$('productCategory').value='';$('productPrice').value='';$('productImage').value='';toast('Товар добавлен');productsAdmin()}catch(e){toast(e.message,true)}};
window.editProduct=raw=>{const p=typeof raw==='string'?unpack(raw):raw;openModal(`<div class="modal-head"><h2>Изменить товар</h2><button class="modal-close" onclick="closeModal()">×</button></div><div class="edit-product-image">${p.image_url?`<img src="${p.image_url}" alt="${esc(p.name)}">`:'☕'}</div><input id="mName" class="input" value="${esc(p.name)}"><input id="mCategory" class="input" value="${esc(p.category)}"><input id="mPrice" class="input" type="number" value="${p.price}"><label class="file-input wide-file">📷 Заменить фото<input id="mImage" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="actions"><input id="mActive" type="checkbox" ${p.active?'checked':''}> Показывать товар</label><div class="actions"><button class="btn primary" onclick="saveProduct(${p.id})">Сохранить</button>${p.image_url?`<button class="btn danger" onclick="deleteProductImage(${p.id})">Удалить фото</button>`:''}</div>`)};
window.saveProduct=async id=>{try{await api('/api/products/'+id,{method:'PUT',body:{name:$('mName').value.trim(),category:$('mCategory').value.trim(),price:Number($('mPrice').value),active:$('mActive').checked}});const file=$('mImage')?.files?.[0];if(file)await uploadProductImage(id,file);closeModal();toast('Товар обновлён');productsAdmin()}catch(e){toast(e.message,true)}};
window.deleteProductImage=async id=>{try{await api(`/api/products/${id}/image`,{method:'DELETE'});closeModal();toast('Фото удалено');productsAdmin()}catch(e){toast(e.message,true)}};

async function warehouse(){const [arr,moves]=await Promise.all([api('/api/warehouse'),api('/api/warehouse-movements')]);$('warehouseList').innerHTML=arr.length?arr.map(x=>`<div class="list-row ${x.low?'low-stock':''}"><div class="list-main"><b>${esc(x.name)} ${x.low?'<span class="low-tag">Заканчивается</span>':''}</b><small>Остаток: ${x.quantity} ${esc(x.unit)} · минимум: ${x.threshold}</small></div><div class="row-actions"><button class="mini green" onclick="receiveStock(${x.id})">Поступление</button><button class="mini" onclick="editStock('${pack(x)}')">Изменить</button><button class="mini red" onclick="deleteStock(${x.id})">Удалить</button></div></div>`).join(''):'<div class="empty">Склад пуст</div>';renderMovements(moves);dashboard()}
function renderMovements(arr){const names={receive:'Поступление',sale:'Списание по продаже',adjustment_in:'Корректировка +',adjustment_out:'Корректировка −'};$('warehouseMovements').innerHTML=arr.length?arr.map(m=>`<div class="list-row"><div class="list-main"><b>${esc(m.item_name)} · ${names[m.type]||esc(m.type)}</b><small>${fmtDate(m.created_at)}${m.reason?' · '+esc(m.reason):''}${m.user_name?' · '+esc(m.user_name):''}</small></div><strong class="${['sale','adjustment_out'].includes(m.type)?'amount-minus':'amount-plus'}">${['sale','adjustment_out'].includes(m.type)?'−':'+'}${m.quantity}</strong></div>`).join(''):'<div class="empty">История пока пустая</div>'}
window.receiveStock=async(id)=>{const quantity=Number(prompt('Сколько поступило?'));if(!quantity||quantity<=0)return;const reason=prompt('Комментарий (необязательно):','Поставка')||'Поставка';try{await api(`/api/warehouse/${id}/receive`,{method:'POST',body:{quantity,reason}});toast('Поступление сохранено');warehouse()}catch(e){toast(e.message,true)}};
$('refreshMovements').onclick=warehouse;
$('addStock').onclick=async()=>{try{await api('/api/warehouse',{method:'POST',body:{name:$('stockName').value.trim(),quantity:Number($('stockQty').value),unit:$('stockUnit').value.trim()||'шт',threshold:Number($('stockThreshold').value||0)}});['stockName','stockQty','stockUnit','stockThreshold'].forEach(id=>$(id).value='');toast('Добавлено на склад');warehouse()}catch(e){toast(e.message,true)}};
window.editStock=raw=>{const x=typeof raw==='string'?unpack(raw):raw;openModal(`<div class="modal-head"><h2>Изменить остаток</h2><button class="modal-close" onclick="closeModal()">×</button></div><input id="msName" class="input" value="${esc(x.name)}"><input id="msQty" class="input" type="number" step="0.001" value="${x.quantity}"><input id="msUnit" class="input" value="${esc(x.unit)}"><input id="msMin" class="input" type="number" step="0.001" value="${x.threshold}"><div class="actions"><button class="btn primary" onclick="saveStock(${x.id})">Сохранить</button></div>`)};
window.saveStock=async id=>{try{await api('/api/warehouse/'+id,{method:'PUT',body:{name:$('msName').value.trim(),quantity:Number($('msQty').value),unit:$('msUnit').value.trim(),threshold:Number($('msMin').value)}});closeModal();toast('Склад обновлён');warehouse()}catch(e){toast(e.message,true)}};
window.deleteStock=async id=>{if(!confirm('Удалить позицию со склада?'))return;try{await api('/api/warehouse/'+id,{method:'DELETE'});toast('Удалено');warehouse()}catch(e){toast(e.message,true)}};

let recipeStocks=[],recipeRows=[];
async function recipes(){const [products,stocks,rows]=await Promise.all([api('/api/products'),api('/api/warehouse'),api('/api/recipes')]);recipeStocks=stocks;recipeRows=rows;$('recipeProduct').innerHTML=products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$('recipeProduct').onchange=renderRecipe;renderRecipe()}
function renderRecipe(){const pid=Number($('recipeProduct').value);$('recipeEditor').innerHTML=recipeStocks.length?recipeStocks.map(s=>{const r=recipeRows.find(x=>Number(x.product_id)===pid&&Number(x.inventory_item_id)===Number(s.id));return `<div class="recipe-row"><div><b>${esc(s.name)}</b><small class="muted"> (${esc(s.unit)})</small></div><input class="input recipe-qty" data-stock="${s.id}" type="number" step="0.001" min="0" value="${r?r.quantity:0}"></div>`}).join(''):'<div class="empty">Сначала добавь позиции на склад</div>'}
$('saveRecipe').onclick=async()=>{const items=[...document.querySelectorAll('.recipe-qty')].map(i=>({inventoryItemId:Number(i.dataset.stock),quantity:Number(i.value)})).filter(x=>x.quantity>0);try{await api('/api/recipes/'+$('recipeProduct').value,{method:'PUT',body:{items}});toast('Рецепт сохранён');recipes()}catch(e){toast(e.message,true)}};

async function reports(){const d=await api('/api/reports?period='+encodeURIComponent($('reportPeriod').value));$('repSales').textContent=money(d.sales)+' сум';$('repCash').textContent=money(d.cash_sales)+' сум';$('repCard').textContent=money(d.card_sales)+' сум';$('repOnline').textContent=money(d.online_sales)+' сум';$('repExpenses').textContent=money(d.expenses)+' сум';$('repProfit').textContent=money(d.profit)+' сум';$('topProducts').innerHTML=d.top.length?d.top.map((x,i)=>`<div class="list-row"><div class="list-main"><b>${i+1}. ${esc(x.name)}</b><small>${x.quantity} шт.</small></div><b>${money(x.revenue)} сум</b></div>`).join(''):'<div class="empty">Пока нет продаж</div>';const max=Math.max(1,...d.daily.map(x=>Number(x.sales)));$('dailyBars').innerHTML=d.daily.length?d.daily.map(x=>`<div class="bar-wrap"><i>${money(x.sales)}</i><div class="bar" style="height:${Math.max(3,Math.round(Number(x.sales)/max*190))}px"></div><small>${esc(x.day)}</small></div>`).join(''):'<div class="empty">Нет данных</div>'}
$('reportPeriod').onchange=reports;

async function receipts(){const arr=await api('/api/sales?limit=100');$('receiptsList').innerHTML=arr.length?arr.map(s=>`<div class="list-row"><div class="list-main"><b>Чек №${s.id}</b><small>${fmtDate(s.created_at)} · ${s.method==='cash'?'Наличные':s.method==='card'?'Карта':'Онлайн'}${s.user_name?' · '+esc(s.user_name):''}</small></div><div class="row-actions"><strong>${money(s.total)} сум</strong><button class="mini" onclick="receipt(${s.id})">Открыть</button></div></div>`).join(''):'<div class="empty">Чеков пока нет</div>'}
window.receipt=async id=>{try{const s=await api('/api/sales/'+id);openModal(`<div class="modal-head"><h2>Чек №${s.id}</h2><button class="modal-close" onclick="closeModal()">×</button></div><p><b>${esc(s.branch_name)}</b><br><span class="muted">${esc(s.branch_address||'')}</span></p><p class="muted">${fmtDate(s.created_at)} · ${esc(s.methodLabel)}${s.user_name?' · '+esc(s.user_name):''}</p><div class="list">${s.items.map(x=>`<div class="list-row"><span>${esc(x.name)} × ${x.quantity}</span><b>${money(x.price*x.quantity)} сум</b></div>`).join('')}</div><h2>Итого: ${money(s.total)} сум</h2><div class="actions"><button class="btn secondary" onclick="window.print()">Печать</button></div>`)}catch(e){toast(e.message,true)}};

async function expenses(){const arr=await api('/api/expenses');$('expensesList').innerHTML=arr.length?arr.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.reason||'Расход')}</b><small>${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}</small></div><strong class="amount-minus">−${money(x.amount)} сум</strong></div>`).join(''):'<div class="empty">Расходов пока нет</div>'}

async function customerQr(){const [d,p]=await Promise.all([api('/api/customer-qr'),api('/api/payment-settings')]);$('menuQr').src=d.dataUrl;$('menuUrl').textContent=d.url;$('openMenuUrl').href=d.url;$('downloadQrPng').href=d.pngUrl;$('downloadQrSvg').href=d.svgUrl;$('copyMenuUrl').onclick=async()=>{await navigator.clipboard.writeText(d.url);toast('Ссылка скопирована')};$('paymeBadge').textContent=p.configured?(p.mode==='test'?'Payme TEST':'Payme подключён'):'Не подключён';$('paymeBadge').className='status '+(p.configured?'ready':'cancelled');$('paymeInfo').textContent=p.configured?'Клиенты могут выбрать онлайн-оплату Payme в QR-меню.':'Чтобы включить оплату, добавь Merchant ID, Login и ключ Payme Business в Environment Variables Render.';$('paymeEndpoint').textContent='Merchant API Endpoint: '+p.merchantApiEndpoint}

async function users(){const arr=await api('/api/users');$('usersList').innerHTML=arr.length?arr.map(u=>`<div class="list-row"><div class="list-main"><b>${esc(u.name)}</b><small>@${esc(u.username)} · ${roleName(u.role)} · ${esc(u.branch_name||'Все филиалы')} · ${u.active?'активен':'отключён'}</small></div><div class="row-actions"><button class="mini" onclick="editUser('${pack(u)}')">Изменить</button><button class="mini orange" onclick="resetUserPassword(${u.id})">Пароль</button></div></div>`).join(''):'<div class="empty">Нет сотрудников</div>'}
$('addUser').onclick=async()=>{try{await api('/api/users',{method:'POST',body:{name:$('userName').value.trim(),username:$('userLogin').value.trim(),password:$('userPassword').value,role:$('userRole').value,branchId:Number($('userBranch').value)}});$('userName').value='';$('userLogin').value='';$('userPassword').value='';toast('Сотрудник добавлен');users()}catch(e){toast(e.message,true)}};
window.editUser=raw=>{const u=typeof raw==='string'?unpack(raw):raw;const branchOpts=state.branches.map(b=>`<option value="${b.id}" ${Number(b.id)===Number(u.branch_id)?'selected':''}>${esc(b.name)}</option>`).join('');openModal(`<div class="modal-head"><h2>Сотрудник</h2><button class="modal-close" onclick="closeModal()">×</button></div><input id="muName" class="input" value="${esc(u.name)}"><select id="muRole" class="select wide"><option value="cashier" ${u.role==='cashier'?'selected':''}>Кассир</option><option value="admin" ${u.role==='admin'?'selected':''}>Администратор</option><option value="owner" ${u.role==='owner'?'selected':''}>Владелец</option></select><select id="muBranch" class="select wide">${branchOpts}</select><label class="actions"><input id="muActive" type="checkbox" ${u.active?'checked':''}> Активен</label><button class="btn primary" onclick="saveUser(${u.id})">Сохранить</button>`)};
window.saveUser=async id=>{try{await api('/api/users/'+id,{method:'PUT',body:{name:$('muName').value.trim(),role:$('muRole').value,branchId:Number($('muBranch').value),active:$('muActive').checked}});closeModal();toast('Сотрудник обновлён');users()}catch(e){toast(e.message,true)}};
window.resetUserPassword=async id=>{const password=prompt('Новый пароль (минимум 8 символов):');if(!password)return;try{await api(`/api/users/${id}/reset-password`,{method:'POST',body:{password}});toast('Пароль изменён')}catch(e){toast(e.message,true)}};

async function branches(){const arr=await api('/api/branches');$('branchesList').innerHTML=arr.map(b=>`<div class="list-row"><div class="list-main"><b>${esc(b.name)}</b><small>${esc(b.address||'Без адреса')} · ${b.active?'активен':'отключён'}</small></div><button class="mini" onclick="editBranch('${pack(b)}')">Изменить</button></div>`).join('')}
$('addBranch').onclick=async()=>{try{await api('/api/branches',{method:'POST',body:{name:$('branchName').value.trim(),address:$('branchAddress').value.trim()}});$('branchName').value='';$('branchAddress').value='';toast('Филиал добавлен');await bootstrap()}catch(e){toast(e.message,true)}};
window.editBranch=raw=>{const b=typeof raw==='string'?unpack(raw):raw;openModal(`<div class="modal-head"><h2>Филиал</h2><button class="modal-close" onclick="closeModal()">×</button></div><input id="mbName" class="input" value="${esc(b.name)}"><input id="mbAddress" class="input" value="${esc(b.address||'')}"><label class="actions"><input id="mbActive" type="checkbox" ${b.active?'checked':''}> Активен</label><button class="btn primary" onclick="saveBranch(${b.id})">Сохранить</button>`)};
window.saveBranch=async id=>{try{await api('/api/branches/'+id,{method:'PUT',body:{name:$('mbName').value.trim(),address:$('mbAddress').value.trim(),active:$('mbActive').checked}});closeModal();toast('Филиал обновлён');await bootstrap()}catch(e){toast(e.message,true)}};

$('changePassword').onclick=async()=>{try{await api('/api/me/password',{method:'POST',body:{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value}});$('currentPassword').value='';$('newPassword').value='';toast('Пароль изменён')}catch(e){toast(e.message,true)}};
$('exportData').onclick=async()=>{try{const r=await fetch('/api/export',{headers:state.branchId?{'X-Branch-Id':state.branchId}:{}});if(!r.ok){let d={};try{d=await r.json()}catch{};throw new Error(d.error||'Не удалось скачать экспорт')}const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`in-coffee-export-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Экспорт скачан')}catch(e){toast(e.message,true)}};

function openModal(html){$('modalBox').innerHTML=html;$('modal').classList.remove('hide')}
window.closeModal=()=>$('modal').classList.add('hide'); $('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};

bootstrap().catch(()=>showLogin());
