const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('ru-RU').format(Number(n || 0));
const fmtDate = d => new Date(d).toLocaleString('ru-RU');
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pack = o => encodeURIComponent(JSON.stringify(o)).replace(/'/g,'%27');
const unpack = s => JSON.parse(decodeURIComponent(s));


const categorySticker=(category='')=>{const c=String(category||'').toLowerCase();
  if(c.includes('айс матча')) return '🍵';
  if(c.includes('лимонад')) return '🍋';
  if(c.includes('мохито')) return '🌿';
  if(c.includes('фреш')) return '🍊';
  if(c.includes('чай')) return '🫖';
  if(c.includes('айс кофе')) return '🧊';
  if(c.includes('кофе')) return '☕';
  if(c.includes('милкшей')) return '🥤';
  if(c.includes('десерт')) return '🍰';
  if(c.includes('добавки')) return '✨';
  return '☕';
};
const productSticker=(name='',category='')=>{const n=String(name||'').toLowerCase(),c=String(category||'').toLowerCase();
  if(n.includes('чизкейк')||n.includes('tiramisu')||n.includes('тирамису')||n.includes('торт')) return '🍰';
  if(c.includes('десерт')) return '🍮';
  if(c.includes('добавки')) return n.includes('сироп')?'🍯':n.includes('слив')?'🥛':n.includes('шот')?'⚡':'✨';
  if(c.includes('чай')) return n.includes('жасмин')?'🌼':'🫖';
  if(c.includes('айс матча')) return n.includes('клубник')?'🍓':n.includes('манго')?'🥭':n.includes('голубик')?'🫐':'🍵';
  if(c.includes('лимонад')) return n.includes('blue ocean')?'🩵':n.includes('клубник')?'🍓':n.includes('манго')?'🥭':n.includes('мараку')?'🥭':n.includes('арбуз')?'🍉':n.includes('киви')?'🥝':'🍋';
  if(c.includes('мохито')) return n.includes('клубник')?'🍓':n.includes('манго')?'🥭':n.includes('мараку')?'🥭':n.includes('арбуз')?'🍉':n.includes('киви')?'🥝':'🌿';
  if(c.includes('фреш')) return n.includes('апельс')?'🍊':n.includes('яблок')?'🍏':n.includes('морков')?'🥕':'🍹';
  if(c.includes('милкшей')) return n.includes('oreo')?'🍪':n.includes('шокол')?'🍫':n.includes('клубник')?'🍓':n.includes('банан')?'🍌':'🥤';
  if(c.includes('айс кофе')) return n.includes('американо')?'🧊':n.includes('капучино')?'🥛':n.includes('латте')?'🥤':'🧋';
  if(c.includes('кофе')) return n.includes('эспрессо')||n.includes('доппио')?'☕':n.includes('американо')?'☕':n.includes('капучино')?'☕':n.includes('латте')?'🥛':n.includes('флэт')?'🤍':n.includes('раф')?'🌰':n.includes('мокка')||n.includes('мокко')?'🍫':'☕';
  return categorySticker(category);
};
const productImage=p=>'';
function printerSettings(){
  const width=localStorage.getItem('inCoffeePrinterWidth')==='58'?'58':'80';
  const auto=localStorage.getItem('inCoffeePrinterAuto')==='1';
  const phone=localStorage.getItem('inCoffeePrinterPhone')||'';
  const qrUrl=localStorage.getItem('inCoffeePrinterQrUrl')||'';
  const footerText=localStorage.getItem('inCoffeePrinterFooterText')||'Спасибо за покупку!';
  return {width,auto,phone,qrUrl,footerText};
}
function defaultMenuQrUrl(){const branchId=state?.branchId?`?branch=${state.branchId}`:'';return `${location.origin}/menu${branchId}`;}
function qrImageUrl(value,size=130){return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(value)}`;}
function printerMeta(){const cfg=printerSettings();const branch=currentBranch();const qrValue=(cfg.qrUrl||defaultMenuQrUrl()).trim();return { ...cfg, branch, qrValue, qrImage: qrValue?qrImageUrl(qrValue,cfg.width==='58'?95:125):''};}

function currentBranch(){return state.branches.find(b=>Number(b.id)===Number(state.branchId))||{};}
function printWindowShell(title){
  const w=window.open('','_blank','width=460,height=720');
  if(!w){toast('Браузер заблокировал окно печати. Разрешите всплывающие окна для сайта.',true);return null;}
  w.document.open();w.document.write(`<!doctype html><html><head><meta charset="UTF-8"><title>${esc(title)}</title></head><body><div style="font-family:Arial,sans-serif;padding:20px">Подготовка печати…</div></body></html>`);w.document.close();
  return w;
}
function thermalDocument(title,bodyHtml){
  const {width}=printerSettings();
  const contentWidth=width==='58'?52:72;
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
  @page{size:${width}mm auto;margin:2mm}
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,"DejaVu Sans",sans-serif;font-size:${width==='58'?'10px':'11px'};line-height:1.35}body{width:${contentWidth}mm;margin:0 auto;padding:1mm 0}.receipt{position:relative}.center{text-align:center}.brand{font-size:${width==='58'?'17px':'20px'};font-weight:900;letter-spacing:.12em}.muted{font-size:.92em;color:#444}.tiny{font-size:.85em;color:#444}.sep{border-top:1px dashed #000;margin:2.2mm 0}.soft-sep{height:1px;background:#000;opacity:.14;margin:2mm 0}.row{display:flex;justify-content:space-between;gap:2mm;align-items:flex-start;margin:1.2mm 0}.row span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}.right{text-align:right;white-space:nowrap}.total{font-size:${width==='58'?'14px':'16px'};font-weight:900;margin-top:2mm}.section{font-weight:900;margin:2.5mm 0 1mm;letter-spacing:.06em}.footer{margin-top:3mm;text-align:center;font-size:.9em}.logo-box{display:flex;justify-content:center;align-items:center;gap:2mm;flex-direction:column}.logo-mark{width:${width==='58'?'17mm':'20mm'};height:${width==='58'?'17mm':'20mm'};border:1px solid #000;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:${width==='58'?'12px':'14px'};letter-spacing:.08em}.top-frame,.bottom-frame{height:1px;background:#000}.ticket-title{display:inline-block;padding:1.1mm 3mm;border:1px solid #000;border-radius:999px;font-weight:900;margin-top:1.3mm}.meta-grid{margin-top:1.4mm}.meta-line{display:flex;justify-content:space-between;gap:2mm;margin:.7mm 0}.meta-line span:last-child{text-align:right}.item-name{font-weight:700}.badge{display:inline-block;border:1px solid #000;padding:.6mm 2.2mm;border-radius:999px;font-size:.85em;font-weight:700}.summary-box{border:1px solid #000;border-radius:2.6mm;padding:1.8mm 2.2mm;margin-top:2mm}.qr-wrap{display:flex;justify-content:center;margin-top:2.2mm}.qr-wrap img{width:${width==='58'?'21mm':'25mm'};height:${width==='58'?'21mm':'25mm'};object-fit:contain}.footer-note{margin-top:2mm;text-align:center}.mini-url{font-size:.8em;word-break:break-all;line-height:1.25}.caps{letter-spacing:.08em;text-transform:uppercase}.no-print{display:none!important}
  </style></head><body><div class="receipt">${bodyHtml}</div><script>window.onload=()=>{setTimeout(()=>window.print(),800)};<\/script></body></html>`;
}
function writeThermalWindow(w,title,bodyHtml){if(!w)return;w.document.open();w.document.write(thermalDocument(title,bodyHtml));w.document.close();w.focus();}
function methodRu(method,label=''){if(label)return label;return method==='cash'?'Наличные':method==='card'?'Карта':method==='online'?'Онлайн':String(method||'');}
window.printReceiptById=async id=>{
  const w=printWindowShell(`Чек №${id}`);if(!w)return;
  try{
    const s=await api('/api/sales/'+id);
    const meta=printerMeta();
    const items=(s.items||[]).map(x=>`<div class="row"><span><span class="item-name">${esc(x.name)}</span><br><span class="tiny">${x.quantity} × ${money(x.price)} сум</span></span><b class="right">${money(Number(x.price)*Number(x.quantity))}</b></div>`).join('');
    const body=`<div class="top-frame"></div><div class="center" style="padding-top:1.6mm"><div class="logo-box"><div class="logo-mark">IC</div><div class="brand">IN COFFEE</div></div><div class="ticket-title caps">Premium receipt</div><div style="margin-top:1.4mm"><b>${esc(s.branch_name||meta.branch.name||'In coffee')}</b>${s.branch_address?`<div class="muted">${esc(s.branch_address)}</div>`:(meta.branch.address?`<div class="muted">${esc(meta.branch.address)}</div>`:'')}${meta.phone?`<div class="muted">Тел: ${esc(meta.phone)}</div>`:''}</div></div><div class="sep"></div><div class="meta-grid"><div class="meta-line"><span>Чек</span><b>№${s.id}</b></div><div class="meta-line"><span>Дата</span><span>${fmtDate(s.created_at)}</span></div>${s.user_name?`<div class="meta-line"><span>Кассир</span><span>${esc(s.user_name)}</span></div>`:''}<div class="meta-line"><span>Оплата</span><span>${esc(s.methodLabel||methodRu(s.method))}</span></div></div><div class="sep"></div>${items}<div class="summary-box"><div class="row total"><span>ИТОГО</span><span>${money(s.total)} сум</span></div></div>${meta.qrImage?`<div class="qr-wrap"><img src="${meta.qrImage}" alt="QR"></div><div class="footer-note tiny">Сканируйте QR для заказа</div><div class="mini-url center">${esc(meta.qrValue)}</div>`:''}<div class="sep"></div><div class="footer">${esc(meta.footerText)}<br><span class="tiny">Спасибо, что выбираете In coffee ☕</span></div><div class="bottom-frame" style="margin-top:2mm"></div>`;
    writeThermalWindow(w,`Чек №${s.id}`,body);
  }catch(e){w.close();toast(e.message,true)}
};
window.printShiftReport=async id=>{
  const w=printWindowShell(`Отчёт смены №${id}`);if(!w)return;
  try{
    const d=await api('/api/cash-shifts/'+id),s=d.shift;
    const meta=printerMeta();
    const branch=meta.branch||{};
    const expenses=(d.operations||[]).filter(x=>x.type==='cash_out');
    const cashIns=(d.operations||[]).filter(x=>x.type==='cash_in');
    const expensesHtml=expenses.length?expenses.map(x=>`<div class="row"><span>${esc(x.reason||'Расход')}<br><span class="tiny">${fmtDate(x.created_at)}</span></span><b class="right">−${money(x.amount)}</b></div>`).join(''):'<div class="tiny">Расходов не было</div>';
    const cashInHtml=cashIns.length?cashIns.map(x=>`<div class="row"><span>${esc(x.reason||'Внесение')}<br><span class="tiny">${fmtDate(x.created_at)}</span></span><b class="right">+${money(x.amount)}</b></div>`).join(''):'<div class="tiny">Внесений не было</div>';
    const salesHtml=(d.sales||[]).length?d.sales.map(x=>`<div class="row"><span>Чек №${x.id} · ${x.method==='cash'?'наличные':x.method==='card'?'карта':'онлайн'}<br><span class="tiny">${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}</span></span><b class="right">${money(x.total)}</b></div>`).join(''):'<div class="tiny">Продаж не было</div>';
    const after=Number(s.closing_total_sales||0)-Number(s.closing_expenses||0);
    const body=`<div class="top-frame"></div><div class="center" style="padding-top:1.6mm"><div class="logo-box"><div class="logo-mark">IC</div><div class="brand">IN COFFEE</div></div><div class="ticket-title caps">Отчёт смены №${s.id}</div><div style="margin-top:1.4mm"><b>${esc(branch.name||'In coffee')}</b>${branch.address?`<div class="muted">${esc(branch.address)}</div>`:''}${meta.phone?`<div class="muted">Тел: ${esc(meta.phone)}</div>`:''}</div></div><div class="sep"></div><div class="meta-grid"><div class="meta-line"><span>Рабочая дата</span><b>${esc(String(s.business_date).slice(0,10))}</b></div><div class="meta-line"><span>Открыта</span><span>${fmtDate(s.opened_at)}</span></div><div class="meta-line"><span>Закрыта</span><span>${fmtDate(s.closed_at)}</span></div>${s.opened_by_name?`<div class="meta-line"><span>Открыл</span><span>${esc(s.opened_by_name)}</span></div>`:''}${s.closed_by_name?`<div class="meta-line"><span>Закрыл</span><span>${esc(s.closed_by_name)}</span></div>`:''}</div><div class="summary-box"><div class="row"><span>Все продажи</span><b>${money(s.closing_total_sales)} сум</b></div><div class="row"><span>Наличные</span><b>${money(s.closing_cash_sales)} сум</b></div><div class="row"><span>Карта</span><b>${money(s.closing_card_sales)} сум</b></div><div class="row"><span>Онлайн</span><b>${money(s.closing_online_sales)} сум</b></div><div class="row"><span>Внесения</span><b>${money(s.closing_cash_in)} сум</b></div><div class="row"><span>Расходы</span><b>−${money(s.closing_expenses)} сум</b></div><div class="soft-sep"></div><div class="row total"><span>После расходов</span><span>${money(after)} сум</span></div></div><div class="sep"></div><div class="section caps">Расходы / куда ушли деньги</div>${expensesHtml}<div class="sep"></div><div class="section caps">Внесения в кассу</div>${cashInHtml}<div class="sep"></div><div class="section caps">Продажи смены</div>${salesHtml}<div class="sep"></div><div class="footer">Отчёт сформирован ${fmtDate(new Date())}<br><span class="tiny">In coffee</span></div><div class="bottom-frame" style="margin-top:2mm"></div>`;
    writeThermalWindow(w,`Отчёт смены №${s.id}`,body);
  }catch(e){w.close();toast(e.message,true)}
};
function testPrinter(){
  const w=printWindowShell('Тест XPrinter');if(!w)return;
  const meta=printerMeta();
  const body=`<div class="top-frame"></div><div class="center" style="padding-top:1.6mm"><div class="logo-box"><div class="logo-mark">IC</div><div class="brand">IN COFFEE</div></div><div class="ticket-title caps">Тест XPrinter</div>${meta.phone?`<div class="muted">Тел: ${esc(meta.phone)}</div>`:''}</div><div class="sep"></div><div class="meta-line"><span>Формат бумаги</span><span>${meta.width} мм</span></div><div class="meta-line"><span>Дата</span><span>${fmtDate(new Date())}</span></div><div class="sep"></div><div class="row"><span><span class="item-name">Капучино</span><br><span class="tiny">1 × 20 000 сум</span></span><b>20 000</b></div><div class="row"><span><span class="item-name">Американо</span><br><span class="tiny">1 × 15 000 сум</span></span><b>15 000</b></div><div class="summary-box"><div class="row total"><span>ИТОГО</span><span>35 000 сум</span></div></div>${meta.qrImage?`<div class="qr-wrap"><img src="${meta.qrImage}" alt="QR"></div><div class="footer-note tiny">Тестовый QR-код</div>`:''}<div class="sep"></div><div class="footer">${esc(meta.footerText)}<br><span class="tiny">Если текст читается нормально — XPrinter готов ✅</span></div><div class="bottom-frame" style="margin-top:2mm"></div>`;
  writeThermalWindow(w,'Тест XPrinter',body);
}

const state = { user:null, branches:[], branchId:null, products:[], cart:[], page:'cash', cashShift:null }; 

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
  const d=await api('/api/me'); state.user=d.user;state.branches=d.branches;setupBranches();setRoleUi();showApp();go('cash');
}

const titles={cash:['Касса','Продажи и оплата'],orders:['Онлайн-заказы','Заказы клиентов'],products:['Товары','Меню и цены'],warehouse:['Склад','Остатки'],recipes:['Рецепты','Автосписание'],reports:['Отчёты','Продажи и прибыль'],receipts:['Чеки','История продаж'],expenses:['Расходы','История расходов'],shifts:['История смен','Закрытые кассы и расходы'],customers:['Клиенты и QR','Регистрации, меню и карта'],users:['Сотрудники','Роли и доступ'],branches:['Филиалы','Управление точками'],settings:['Настройки','Безопасность']};
function go(page){
  const btn=document.querySelector(`#nav button[data-page="${page}"]`); if(!btn || btn.classList.contains('hide'))page='cash';
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
    if(page==='cash')await Promise.all([loadProducts(),loadCashShift()]);
    if(page==='orders')await orders();
    if(page==='products')await productsAdmin();
    if(page==='warehouse')await warehouse();
    if(page==='recipes')await recipes();
    if(page==='reports')await reports();
    if(page==='receipts')await receipts();
    if(page==='expenses')await expenses();
    if(page==='shifts')await cashShiftHistory();
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
  if($('ordersBadge')){$('ordersBadge').textContent=d.pending_orders;$('ordersBadge').classList.toggle('hide',!Number(d.pending_orders));}
  if($('stockBadge')){$('stockBadge').textContent=d.low_stock;$('stockBadge').classList.toggle('hide',!Number(d.low_stock));}
}

async function loadCashShift(){
  const d=await api('/api/cash-shift');state.cashShift=d;
  const current=d.current||d.today||{};const isOpen=Boolean(d.open);
  $('shiftBadge').textContent=isOpen?'Касса открыта':'Касса закрыта';$('shiftBadge').className='status '+(isOpen?'ready':'cancelled');
  $('shiftTitle').textContent=isOpen?`Смена №${d.shift.id} открыта`:'Смена не открыта';
  $('shiftMeta').textContent=isOpen?`Открыта ${fmtDate(d.shift.opened_at)} · рабочая дата ${d.shift.business_date}`:`Рабочая дата ${d.businessDate} · новая смена начнётся с 0 сум.`;
  $('openShift').classList.toggle('hide',isOpen);$('closeShift').classList.toggle('hide',!isOpen);
  $('shiftTodaySales').textContent=money(current.total_sales||0)+' сум';$('shiftCashSales').textContent=money(current.cash_sales||0)+' сум';$('shiftCardSales').textContent=money(current.card_sales||0)+' сум';$('shiftOnlineSales').textContent=money(current.online_sales||0)+' сум';$('shiftExpenses').textContent=money(current.expenses||0)+' сум';$('shiftProfit').textContent=money(current.profit_after_expenses||0)+' сум';
  const disabled=!isOpen;$('cashPay').disabled=disabled;$('cardPay').disabled=disabled;$('cashIn').disabled=disabled;if($('cashOut'))$('cashOut').disabled=disabled;
  $('lastShiftInfo').textContent=d.lastClosed?`Последняя закрытая смена №${d.lastClosed.id}: ${money(d.lastClosed.closing_total_sales)} сум продаж · ${money(d.lastClosed.closing_expenses)} сум расходов · закрыта ${fmtDate(d.lastClosed.closed_at)}`:'Закрытых смен пока нет.';
}
$('openShift').onclick=async()=>{try{await api('/api/cash-shift/open',{method:'POST'});toast('Касса открыта');await loadCashShift()}catch(e){toast(e.message,true)}};
$('closeShift').onclick=async()=>{if(!confirm('Закрыть кассу и сохранить итог текущей смены в историю?'))return;try{const d=await api('/api/cash-shift/close',{method:'POST'});state.cashShift=null;const s=d.summary||{};const expenseRows=(d.expenses||[]).length?`<div class="shift-expense-list"><h3>Расходы этой смены</h3>${d.expenses.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.reason||'Расход')}</b><small>${fmtDate(x.created_at)}</small></div><strong class="amount-minus">−${money(x.amount)} сум</strong></div>`).join('')}</div>`:'<p class="muted">Расходов в этой смене не было.</p>';openModal(`<div class="modal-head"><h2>Смена закрыта ✅</h2><button class="modal-close" onclick="closeModal()">×</button></div><p class="muted">Рабочая дата: ${esc(String(d.shift.business_date).slice(0,10))}</p><div class="shift-close-summary"><div><span>Продажи</span><b>${money(s.total_sales)} сум</b></div><div><span>Наличные</span><b>${money(s.cash_sales)} сум</b></div><div><span>Карта</span><b>${money(s.card_sales)} сум</b></div><div><span>Онлайн</span><b>${money(s.online_sales)} сум</b></div><div><span>Расходы</span><b>${money(s.expenses)} сум</b></div><div><span>После расходов</span><b>${money(s.profit_after_expenses)} сум</b></div></div><p><b>Наличные по закрытой смене: ${money(s.cash_balance_from_shift)} сум</b></p>${expenseRows}<div class="actions"><button class="btn primary" onclick="printShiftReport(${d.shift.id})">🖨 Печать отчёта</button><button class="btn secondary" onclick="closeModal()">Готово</button><button class="btn secondary" onclick="closeModal();go('shifts')">Открыть историю смен</button></div>`);toast('Касса закрыта и сохранена в истории');await Promise.all([loadCashShift(),dashboard()])}catch(e){toast(e.message,true)}};

async function loadProducts(){state.products=await api('/api/products');renderProducts();renderCart()}
function renderProducts(){
  const q=$('productSearch').value.trim().toLowerCase(); const arr=state.products.filter(p=>!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q));
  $('posProducts').innerHTML=arr.length?arr.map(p=>{const icon=productSticker(p.name,p.category);return `<button class="product-card" data-product="${p.id}"><div class="product-thumb sticker-thumb"><span class="sticker-emoji">${icon}</span></div><b>${esc(p.name)}</b><small>${esc(p.category)}</small><span>${money(p.price)} сум</span></button>`}).join(''):'<div class="empty">Ничего не найдено</div>';
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
async function pay(method){if(!state.cart.length)return toast('Добавь товар в чек',true);try{const d=await api('/api/sale',{method:'POST',body:{method,items:state.cart.map(({productId,quantity})=>({productId,quantity}))}});state.cart=[];renderCart();toast(`Продажа №${d.sale.id} на ${money(d.sale.total)} сум`);openModal(`<div class="modal-head"><h2>Продажа сохранена ✅</h2><button class="modal-close" onclick="closeModal()">×</button></div><p>Чек №${d.sale.id}</p><h2>${money(d.sale.total)} сум</h2><div class="actions"><button class="btn primary" onclick="printReceiptById(${d.sale.id})">🖨 Печать чека</button><button class="btn secondary" onclick="closeModal()">Без печати</button></div>`);await Promise.all([dashboard(),loadCashShift()]);if(printerSettings().auto)toast('Продажа готова — нажмите «Печать чека»')}catch(e){toast(e.message,true)}}
$('cashPay').onclick=()=>pay('cash');$('cardPay').onclick=()=>pay('card');
$('cashIn').onclick=async()=>{const amount=Number(prompt('Сколько внести в кассу?'));if(!amount)return;try{await api('/api/cash',{method:'POST',body:{type:'cash_in',amount}});toast('Деньги внесены');await Promise.all([dashboard(),loadCashShift()])}catch(e){toast(e.message,true)}};
$('cashOut').onclick=async()=>{const amount=Number(prompt('Сколько изъять?'));if(!amount)return;const reason=prompt('Куда / на что ушли деньги? Укажите подробно:');if(!reason?.trim())return;try{await api('/api/cash',{method:'POST',body:{type:'cash_out',amount,reason:reason.trim()}});toast('Расход сохранён');await Promise.all([dashboard(),loadCashShift()])}catch(e){toast(e.message,true)}};

const statusNames={new:'Новый',accepted:'Принят',ready:'Готов',completed:'Завершён',cancelled:'Отменён'};
const paymentNames={cash:'При получении',payme:'Payme',receipt:'Перевод на карту + чек'}; const paymentStatusNames={unpaid:'Не оплачено',pending:'Ожидание оплаты',review:'Чек на проверке',rejected:'Чек отклонён',paid:'Оплачено',cancelled:'Отменено'};
async function orders(){const arr=await api('/api/orders');$('ordersList').innerHTML=arr.length?arr.map(o=>`<div class="order-card ${o.status}"><div class="list-row"><div class="list-main"><b>Заказ №${o.id} · ${esc(o.customer_name)}</b><small>${esc(o.customer_phone)} · ${fmtDate(o.created_at)} · ${paymentNames[o.payment_method]||esc(o.payment_method)} · ${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</small>${o.promo_code?`<small>🎁 ${esc(o.promo_code)} · скидка ${money(o.discount_amount)} сум</small>`:''}${`<small>🚗 Доставка · ${esc(o.delivery_address||'Адрес не указан')}</small>`}</div><div class="row-actions"><span class="status ${o.payment_status==='paid'?'ready':o.payment_status==='pending'?'accepted':''}">${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</span><span class="status ${o.status}">${statusNames[o.status]}</span><strong>${money(o.total)} сум</strong><button class="mini" onclick="openOrder(${o.id})">Открыть</button></div></div></div>`).join(''):'<div class="empty">Онлайн-заказов пока нет</div>';dashboard()}
$('refreshOrders').onclick=orders;
window.openOrder=async id=>{try{const o=await api('/api/orders/'+id);const paid=['payme','receipt'].includes(o.payment_method)&&o.payment_status==='paid';const delivery=o.delivery_type==='delivery';const mapUrl=deliveryMapLink(o);const receipt=o.payment_method==='receipt'&&o.has_payment_receipt?`<div class="delivery-info"><b>🧾 Чек оплаты</b><div style="margin-top:10px"><img src="/api/orders/${o.id}/receipt" alt="Чек оплаты" style="max-width:100%;max-height:420px;border-radius:14px"></div>${o.payment_status==='review'?`<div class="actions"><button class="btn success" onclick="reviewPayment(${o.id},'approve')">✅ Подтвердить оплату</button><button class="btn danger" onclick="reviewPayment(${o.id},'reject')">❌ Отклонить чек</button></div>`:''}</div>`:'';const promoInfo=o.discount_amount?`<div class="delivery-info"><b>🎁 Промокод</b><p>${esc(o.promo_code||'FIRST10')} · скидка ${money(o.discount_amount)} сум</p></div>`:'';openModal(`<div class="modal-head"><h2>Заказ №${o.id}</h2><button class="modal-close" onclick="closeModal()">×</button></div><p><b>${esc(o.customer_name)}</b><br>${esc(o.customer_phone)}</p><p class="muted">Оплата: ${paymentNames[o.payment_method]||esc(o.payment_method)} · <b>${paymentStatusNames[o.payment_status]||esc(o.payment_status)}</b></p>${promoInfo}${receipt}${delivery?`<div class="delivery-info"><b>🚗 Доставка</b><p>${esc(o.delivery_address||'Адрес не указан')}</p>${o.delivery_comment?`<p class="muted">Комментарий: ${esc(o.delivery_comment)}</p>`:''}${mapUrl?`<a class="btn secondary" href="${mapUrl}" target="_blank" rel="noopener">📍 Открыть в Яндекс Картах</a>`:''}</div>`:'<p><b>🏪 Самовывоз</b></p>'}<div class="list">${o.items.map(x=>`<div class="list-row"><span>${esc(x.name)} × ${x.quantity}</span><b>${money(x.price*x.quantity)} сум</b></div>`).join('')}</div><h3>Итого: ${money(o.total)} сум</h3><div class="actions">${o.status==='new'&&(o.payment_method!=='receipt'||o.payment_status==='paid')?`<button class="btn primary" onclick="orderStatus(${o.id},'accepted')">Принять</button>`:''}${['new','accepted'].includes(o.status)&&(o.payment_method!=='receipt'||o.payment_status==='paid')?`<button class="btn success" onclick="orderStatus(${o.id},'ready')">Готов</button>`:''}${o.status==='ready'?(paid?`<button class="btn success" onclick="completeOrder(${o.id},'online')">✅ Выдать оплаченный заказ</button>`:`<button class="btn success" onclick="completeOrder(${o.id},'cash')">💵 Выдать за наличные</button><button class="btn primary" onclick="completeOrder(${o.id},'card')">💳 Выдать по карте</button>`):''}${!['completed','cancelled'].includes(o.status)?`<button class="btn danger" onclick="orderStatus(${o.id},'cancelled')">Отменить</button>`:''}</div>`)}catch(e){toast(e.message,true)}};
window.reviewPayment=async(id,action)=>{try{await api(`/api/orders/${id}/payment-review`,{method:'PUT',body:{action}});closeModal();toast(action==='approve'?'Оплата подтверждена':'Чек отклонён');orders()}catch(e){toast(e.message,true)}};
function deliveryMapLink(o){if(o.delivery_lat!=null&&o.delivery_lng!=null){const lat=Number(o.delivery_lat),lng=Number(o.delivery_lng);if(Number.isFinite(lat)&&Number.isFinite(lng))return `https://yandex.com/maps/?pt=${encodeURIComponent(lng+','+lat)}&z=17&l=map`}if(o.delivery_address)return `https://yandex.com/maps/?text=${encodeURIComponent(o.delivery_address)}`;return ''}
window.orderStatus=async(id,status)=>{try{await api(`/api/orders/${id}/status`,{method:'PUT',body:{status}});closeModal();toast('Статус обновлён');orders()}catch(e){toast(e.message,true)}};
window.completeOrder=async(id,paymentMethod)=>{try{await api(`/api/orders/${id}/status`,{method:'PUT',body:{status:'completed',paymentMethod}});closeModal();toast('Заказ выдан и добавлен в продажи');orders()}catch(e){toast(e.message,true)}};

async function productsAdmin(){const arr=await api('/api/products/all');$('productsList').innerHTML=arr.length?arr.map(p=>{const icon=productSticker(p.name,p.category);return `<div class="list-row product-admin-row"><div class="product-admin-info"><div class="product-fallback sticker-thumb"><span class="sticker-emoji">${icon}</span></div><div class="list-main"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${money(p.price)} сум · ${p.active?'Активен':'Скрыт'}</small></div></div><div class="row-actions"><button class="mini" onclick="editProduct('${pack(p)}')">Изменить</button></div></div>`}).join(''):'<div class="empty">Нет товаров</div>'}
$('addProduct').onclick=async()=>{try{const d=await api('/api/products',{method:'POST',body:{name:$('productName').value.trim(),category:$('productCategory').value.trim()||'Кофе',price:Number($('productPrice').value)}});const file=$('productImage').files[0];if(file)await uploadProductImage(d.product.id,file);$('productName').value='';$('productCategory').value='';$('productPrice').value='';$('productImage').value='';toast('Товар добавлен');productsAdmin()}catch(e){toast(e.message,true)}};
window.editProduct=raw=>{const p=typeof raw==='string'?unpack(raw):raw;const icon=productSticker(p.name,p.category);openModal(`<div class="modal-head"><h2>Изменить товар</h2><button class="modal-close" onclick="closeModal()">×</button></div><div class="edit-product-image sticker-thumb"><span class="sticker-emoji large">${icon}</span></div><input id="mName" class="input" value="${esc(p.name)}"><input id="mCategory" class="input" value="${esc(p.category)}"><input id="mPrice" class="input" type="number" value="${p.price}"><label class="file-input wide-file">📷 Заменить фото<input id="mImage" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="actions"><input id="mActive" type="checkbox" ${p.active?'checked':''}> Показывать товар</label><div class="actions"><button class="btn primary" onclick="saveProduct(${p.id})">Сохранить</button>${p.image_url?`<button class="btn danger" onclick="deleteProductImage(${p.id})">Удалить фото</button>`:''}</div><div class="muted tiny">Сейчас вместо фотографий в меню показываются подходящие стикеры. Фото можно загрузить позже, когда понадобятся.</div>`)};
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

async function receipts(){const arr=await api('/api/sales?limit=100');$('receiptsList').innerHTML=arr.length?arr.map(s=>`<div class="list-row"><div class="list-main"><b>Чек №${s.id}</b><small>${fmtDate(s.created_at)} · ${s.method==='cash'?'Наличные':s.method==='card'?'Карта':'Онлайн'}${s.user_name?' · '+esc(s.user_name):''}</small></div><div class="row-actions"><strong>${money(s.total)} сум</strong><button class="mini" onclick="receipt(${s.id})">Открыть</button><button class="mini green" onclick="printReceiptById(${s.id})">🖨</button></div></div>`).join(''):'<div class="empty">Чеков пока нет</div>'}
window.receipt=async id=>{try{const s=await api('/api/sales/'+id);openModal(`<div class="modal-head"><h2>Чек №${s.id}</h2><button class="modal-close" onclick="closeModal()">×</button></div><p><b>${esc(s.branch_name)}</b><br><span class="muted">${esc(s.branch_address||'')}</span></p><p class="muted">${fmtDate(s.created_at)} · ${esc(s.methodLabel)}${s.user_name?' · '+esc(s.user_name):''}</p><div class="list">${s.items.map(x=>`<div class="list-row"><span>${esc(x.name)} × ${x.quantity}</span><b>${money(x.price*x.quantity)} сум</b></div>`).join('')}</div><h2>Итого: ${money(s.total)} сум</h2><div class="actions"><button class="btn primary" onclick="printReceiptById(${s.id})">🖨 Печать на XPrinter</button></div>`)}catch(e){toast(e.message,true)}};

async function expenses(){const arr=await api('/api/expenses');$('expensesList').innerHTML=arr.length?arr.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.reason||'Расход')}</b><small>${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}</small></div><strong class="amount-minus">−${money(x.amount)} сум</strong></div>`).join(''):'<div class="empty">Расходов пока нет</div>'}

async function cashShiftHistory(){
  const arr=await api('/api/cash-shifts?limit=100');
  const totalSales=arr.reduce((s,x)=>s+Number(x.closing_total_sales||0),0),totalExpenses=arr.reduce((s,x)=>s+Number(x.closing_expenses||0),0);
  $('shiftHistoryCount').textContent=arr.length;$('shiftHistorySales').textContent=money(totalSales)+' сум';$('shiftHistoryExpenses').textContent=money(totalExpenses)+' сум';$('shiftHistoryProfit').textContent=money(totalSales-totalExpenses)+' сум';
  $('shiftHistoryList').innerHTML=arr.length?arr.map(x=>`<div class="shift-history-card"><div class="list-row"><div class="list-main"><b>Смена №${x.id} · ${esc(String(x.business_date).slice(0,10))}</b><small>Открыта ${fmtDate(x.opened_at)} · закрыта ${fmtDate(x.closed_at)}${x.closed_by_name?' · '+esc(x.closed_by_name):''}</small><small>${x.receipts_count} продаж · ${x.expenses_count} расходов</small></div><div class="row-actions"><strong>${money(x.closing_total_sales)} сум</strong><button class="mini" onclick="openCashShiftHistory(${x.id})">Подробнее</button><button class="mini green" onclick="printShiftReport(${x.id})">🖨</button></div></div><div class="shift-history-mini"><span>Наличные <b>${money(x.closing_cash_sales)}</b></span><span>Карта <b>${money(x.closing_card_sales)}</b></span><span>Онлайн <b>${money(x.closing_online_sales)}</b></span><span>Расходы <b class="amount-minus">${money(x.closing_expenses)}</b></span><span>После расходов <b>${money(Number(x.closing_total_sales||0)-Number(x.closing_expenses||0))}</b></span></div></div>`).join(''):'<div class="empty">Закрытых смен пока нет</div>';
}
$('refreshShifts').onclick=()=>cashShiftHistory().catch(e=>toast(e.message,true));
window.openCashShiftHistory=async id=>{try{const d=await api('/api/cash-shifts/'+id),s=d.shift;const expenses=d.operations.filter(x=>x.type==='cash_out'),cashIns=d.operations.filter(x=>x.type==='cash_in');const saleHtml=d.sales.length?d.sales.map(x=>`<div class="list-row"><div class="list-main"><b>Чек №${x.id} · ${x.method==='cash'?'Наличные':x.method==='card'?'Карта':'Онлайн'}</b><small>${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}${x.items?.length?' · '+x.items.map(i=>esc(i.name)+' × '+i.quantity).join(', '):''}</small></div><strong>${money(x.total)} сум</strong></div>`).join(''):'<div class="empty">Продаж не было</div>';const expenseHtml=expenses.length?expenses.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.reason||'Расход без комментария')}</b><small>${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}</small></div><strong class="amount-minus">−${money(x.amount)} сум</strong></div>`).join(''):'<div class="empty">Расходов не было</div>';const cashInHtml=cashIns.length?cashIns.map(x=>`<div class="list-row"><div class="list-main"><b>${esc(x.reason||'Внесение в кассу')}</b><small>${fmtDate(x.created_at)}${x.user_name?' · '+esc(x.user_name):''}</small></div><strong class="amount-plus">+${money(x.amount)} сум</strong></div>`).join(''):'<div class="empty">Внесений не было</div>';openModal(`<div class="modal-head"><div><h2>Смена №${s.id}</h2><small>${esc(String(s.business_date).slice(0,10))} · ${fmtDate(s.opened_at)} — ${fmtDate(s.closed_at)}</small></div><button class="modal-close" onclick="closeModal()">×</button></div><div class="shift-close-summary"><div><span>Все продажи</span><b>${money(s.closing_total_sales)} сум</b></div><div><span>Наличные</span><b>${money(s.closing_cash_sales)} сум</b></div><div><span>Карта</span><b>${money(s.closing_card_sales)} сум</b></div><div><span>Онлайн</span><b>${money(s.closing_online_sales)} сум</b></div><div><span>Расходы</span><b>${money(s.closing_expenses)} сум</b></div><div><span>После расходов</span><b>${money(Number(s.closing_total_sales||0)-Number(s.closing_expenses||0))} сум</b></div></div><h3>💸 Куда ушли деньги</h3><div class="list">${expenseHtml}</div><h3>➕ Внесения в кассу</h3><div class="list">${cashInHtml}</div><h3>🧾 Продажи смены</h3><div class="list">${saleHtml}</div><div class="actions"><button class="btn primary" onclick="printShiftReport(${s.id})">🖨 Печать отчёта смены</button></div>`)}catch(e){toast(e.message,true)}};

async function customerQr(){
  const [d,p,maps,stats,customers]=await Promise.all([api('/api/customer-qr'),api('/api/payment-settings'),api('/api/maps-settings'),api('/api/customer-stats'),api('/api/customers')]);
  $('menuQr').src=d.dataUrl;$('menuUrl').textContent=d.url;$('openMenuUrl').href=d.url;$('downloadQrPng').href=d.pngUrl;$('downloadQrSvg').href=d.svgUrl;$('copyMenuUrl').onclick=async()=>{await navigator.clipboard.writeText(d.url);toast('Ссылка скопирована')};
  $('paymeBadge').textContent=p.configured?'Перевод по чеку подключён':'Нужно настроить';$('paymeBadge').className='status '+(p.configured?'ready':'cancelled');$('paymeInfo').textContent=p.configured?`Клиенты переводят деньги на карту ${p.cardNumber||''} и загружают чек. Оплата подтверждается вручную.`:'Введите номер карты и имя получателя ниже, затем нажмите «Сохранить карту».';$('transferCardAdmin').value=p.cardNumber||'';$('transferHolderAdmin').value=p.cardHolder||'';$('paymeEndpoint').textContent=p.configured?`Получатель: ${p.cardHolder||'не указан'}`:'Онлайн-оплата по чеку ещё не настроена';
  $('mapsBadge').textContent=maps.configured?'Карта подключена':'Не подключена';$('mapsBadge').className='status '+(maps.configured?'ready':'cancelled');$('mapsInfo').textContent=maps.configured?'Яндекс Карта подключена. Клиент может искать адрес и выбирать точку доставки.':'Создайте ключ JavaScript API в кабинете разработчика Яндекса и сохраните его здесь.';$('yandexMapKey').value=maps.apiKey||'';
  $('custTotal').textContent=stats.total||0;$('custToday').textContent=stats.today||0;$('custVerified').textContent=stats.verified||0;$('custWithOrders').textContent=stats.with_orders||0;
  $('customersList').innerHTML=customers.length?customers.map(c=>`<div class="list-row"><div class="list-main"><b>${esc(c.name)}</b><small>${esc(c.phone)} · регистрация ${fmtDate(c.created_at)} · ${c.phone_verified?'✅ подтверждён':'⚠️ не подтверждён'}</small></div><div class="row-actions"><span class="status ${c.active?'ready':'cancelled'}">${c.active?'Активен':'Отключён'}</span><strong>${c.orders_count} заказов</strong><span class="muted">${money(c.paid_total)} сум</span></div></div>`).join(''):'<div class="empty">Пока нет зарегистрированных клиентов</div>';
}
$('refreshCustomers').onclick=()=>customerQr().catch(e=>toast(e.message,true));
$('saveTransferSettings').onclick=async()=>{try{await api('/api/payment-settings',{method:'PUT',body:{cardNumber:$('transferCardAdmin').value.trim(),cardHolder:$('transferHolderAdmin').value.trim()}});toast('Карта для оплаты сохранена');await customerQr()}catch(e){toast(e.message,true)}};
$('saveYandexMapSettings').onclick=async()=>{try{await api('/api/maps-settings',{method:'PUT',body:{apiKey:$('yandexMapKey').value.trim()}});toast('Яндекс Карта подключена');await customerQr()}catch(e){toast(e.message,true)}};

async function users(){const arr=await api('/api/users');$('usersList').innerHTML=arr.length?arr.map(u=>`<div class="list-row"><div class="list-main"><b>${esc(u.name)}</b><small>@${esc(u.username)} · ${roleName(u.role)} · ${esc(u.branch_name||'Все филиалы')} · ${u.active?'активен':'отключён'}</small></div><div class="row-actions"><button class="mini" onclick="editUser('${pack(u)}')">Изменить</button><button class="mini orange" onclick="resetUserPassword(${u.id})">Пароль</button></div></div>`).join(''):'<div class="empty">Нет сотрудников</div>'}
$('addUser').onclick=async()=>{try{await api('/api/users',{method:'POST',body:{name:$('userName').value.trim(),username:$('userLogin').value.trim(),password:$('userPassword').value,role:$('userRole').value,branchId:Number($('userBranch').value)}});$('userName').value='';$('userLogin').value='';$('userPassword').value='';toast('Сотрудник добавлен');users()}catch(e){toast(e.message,true)}};
window.editUser=raw=>{const u=typeof raw==='string'?unpack(raw):raw;const branchOpts=state.branches.map(b=>`<option value="${b.id}" ${Number(b.id)===Number(u.branch_id)?'selected':''}>${esc(b.name)}</option>`).join('');openModal(`<div class="modal-head"><h2>Сотрудник</h2><button class="modal-close" onclick="closeModal()">×</button></div><input id="muName" class="input" value="${esc(u.name)}"><select id="muRole" class="select wide"><option value="cashier" ${u.role==='cashier'?'selected':''}>Кассир</option><option value="admin" ${u.role==='admin'?'selected':''}>Администратор</option><option value="owner" ${u.role==='owner'?'selected':''}>Владелец</option></select><select id="muBranch" class="select wide">${branchOpts}</select><label class="actions"><input id="muActive" type="checkbox" ${u.active?'checked':''}> Активен</label><button class="btn primary" onclick="saveUser(${u.id})">Сохранить</button>`)};
window.saveUser=async id=>{try{await api('/api/users/'+id,{method:'PUT',body:{name:$('muName').value.trim(),role:$('muRole').value,branchId:Number($('muBranch').value),active:$('muActive').checked}});closeModal();toast('Сотрудник обновлён');users()}catch(e){toast(e.message,true)}};
window.resetUserPassword=async id=>{const password=prompt('Новый пароль (минимум 8 символов):');if(!password)return;try{await api(`/api/users/${id}/reset-password`,{method:'POST',body:{password}});toast('Пароль изменён')}catch(e){toast(e.message,true)}};

async function branches(){const arr=await api('/api/branches');$('branchesList').innerHTML=arr.map(b=>`<div class="list-row"><div class="list-main"><b>${esc(b.name)}</b><small>${esc(b.address||'Без адреса')} · ${b.active?'активен':'отключён'}</small></div><button class="mini" onclick="editBranch('${pack(b)}')">Изменить</button></div>`).join('')}
$('addBranch').onclick=async()=>{try{await api('/api/branches',{method:'POST',body:{name:$('branchName').value.trim(),address:$('branchAddress').value.trim()}});$('branchName').value='';$('branchAddress').value='';toast('Филиал добавлен');await bootstrap()}catch(e){toast(e.message,true)}};
window.editBranch=raw=>{const b=typeof raw==='string'?unpack(raw):raw;openModal(`<div class="modal-head"><h2>Филиал</h2><button class="modal-close" onclick="closeModal()">×</button></div><input id="mbName" class="input" value="${esc(b.name)}"><input id="mbAddress" class="input" value="${esc(b.address||'')}"><label class="actions"><input id="mbActive" type="checkbox" ${b.active?'checked':''}> Активен</label><button class="btn primary" onclick="saveBranch(${b.id})">Сохранить</button>`)};
window.saveBranch=async id=>{try{await api('/api/branches/'+id,{method:'PUT',body:{name:$('mbName').value.trim(),address:$('mbAddress').value.trim(),active:$('mbActive').checked}});closeModal();toast('Филиал обновлён');await bootstrap()}catch(e){toast(e.message,true)}};

const printerCfg=printerSettings();$('printerPaperWidth').value=printerCfg.width;$('printerAutoReceipt').checked=printerCfg.auto;$('printerPhone').value=printerCfg.phone;$('printerQrUrl').value=printerCfg.qrUrl||defaultMenuQrUrl();$('printerFooterText').value=printerCfg.footerText;
$('savePrinterSettings').onclick=()=>{localStorage.setItem('inCoffeePrinterWidth',$('printerPaperWidth').value==='58'?'58':'80');localStorage.setItem('inCoffeePrinterAuto',$('printerAutoReceipt').checked?'1':'0');localStorage.setItem('inCoffeePrinterPhone',$('printerPhone').value.trim());localStorage.setItem('inCoffeePrinterQrUrl',$('printerQrUrl').value.trim()||defaultMenuQrUrl());localStorage.setItem('inCoffeePrinterFooterText',$('printerFooterText').value.trim()||'Спасибо за покупку!');toast('Настройки XPrinter сохранены')};
$('testPrinter').onclick=testPrinter;

$('changePassword').onclick=async()=>{try{await api('/api/me/password',{method:'POST',body:{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value}});$('currentPassword').value='';$('newPassword').value='';toast('Пароль изменён')}catch(e){toast(e.message,true)}};
$('exportData').onclick=async()=>{try{const r=await fetch('/api/export',{headers:state.branchId?{'X-Branch-Id':state.branchId}:{}});if(!r.ok){let d={};try{d=await r.json()}catch{};throw new Error(d.error||'Не удалось скачать экспорт')}const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`in-coffee-export-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Экспорт скачан')}catch(e){toast(e.message,true)}};

function openModal(html){$('modalBox').innerHTML=html;$('modal').classList.remove('hide')}
window.closeModal=()=>$('modal').classList.add('hide'); $('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};

bootstrap().catch(()=>showLogin());
