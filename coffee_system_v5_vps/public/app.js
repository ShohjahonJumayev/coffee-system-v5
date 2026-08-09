const $=x=>document.getElementById(x),money=n=>new Intl.NumberFormat("ru-RU").format(n);let total=0,cart=[];
$("loginBtn").onclick=login;$("p").onkeydown=e=>{if(e.key==="Enter")login()};$("u").onkeydown=e=>{if(e.key==="Enter")login()};
async function login(){try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("u").value.trim(),password:$("p").value})}),d=await r.json();if(!r.ok){$("msg").textContent=d.error;return}$("login").classList.add("hide");$("app").classList.remove("hide");dashboard();loadProducts()}catch(e){$("msg").textContent="Сервер не отвечает"}}
$("logout").onclick=()=>location.reload();
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{document.querySelectorAll("main>section").forEach(s=>s.classList.add("hide"));$(b.dataset.page).classList.remove("hide");if(b.dataset.page==="dash")dashboard();if(b.dataset.page==="cash")loadProducts();if(b.dataset.page==="goods")goods();if(b.dataset.page==="warehouse")warehouse();if(b.dataset.page==="recipes")recipes();if(b.dataset.page==="ops")ops();if(b.dataset.page==="expenses")expenses()});
async function dashboard(){const d=await fetch("/api/dashboard").then(r=>r.json());$("cashSum").textContent=money(d.cash)+" сум";$("salesSum").textContent=money(d.sales)+" сум";$("cardSum").textContent=money(d.card)+" сум";$("recent").innerHTML=d.operations.length?d.operations.map(row).join(""):"Операций пока нет"}
function row(o){return `<div class="row"><span>${o.time} · ${o.type}${o.type==="cash_out"&&o.reason?" · "+o.reason:""}</span><b>${o.type==="cash_out"?"−":"+"}${money(o.amount)} сум</b></div>`}
async function loadProducts(){const p=await fetch("/api/products").then(r=>r.json());$("buttons").innerHTML=p.map((x,i)=>`<div class="product" data-id="${x.id||i+1}" data-price="${x.price}">${x.name}<br><b>${money(x.price)} сум</b></div>`).join("");document.querySelectorAll(".product").forEach(x=>x.onclick=()=>{const id=Number(x.dataset.id),found=cart.find(i=>i.productId===id);if(found)found.quantity++;else cart.push({productId:id,quantity:1});total+=+x.dataset.price;$("total").textContent=money(total)})}
async function goods(){
  const p=await fetch("/api/products").then(r=>r.json());
  $("goodsList").innerHTML=p.map((x,i)=>`
    <div class="row">
      <span><b>${x.name}</b><br><small>Текущая цена: ${money(x.price)} сум</small></span>
      <span>
        <button onclick="editPrice(${x.id||i+1},'${x.name.replace(/'/g,"\\'")}',${x.price})">✏️ Изменить</button>
        <button class="red" onclick="deleteProduct(${x.id||i+1},'${x.name.replace(/'/g,"\\'")}')">🗑️ Удалить</button>
      </span>
    </div>`).join("");
}
async function deleteProduct(id,name){
  if(!confirm("Удалить товар «"+name+"»?")) return;
  const r=await fetch("/api/products/"+id,{method:"DELETE"});
  const d=await r.json();
  if(!r.ok){alert(d.error||"Не удалось удалить товар");return}
  alert("Товар удалён");
  goods();
  loadProducts();
}
async function editPrice(id,name,current){
  const value=prompt("Новая цена для «"+name+"»:",current);
  if(value===null)return;
  const price=Number(value);
  if(!price || price<0){alert("Введите корректную цену");return;}
  const r=await fetch("/api/products/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({price})});
  const d=await r.json();
  if(!r.ok){alert(d.error||"Не удалось изменить цену");return;}
  alert("Цена изменена");
  goods();
  loadProducts();
}
async function sale(method){if(!total)return alert("Выберите товар");await fetch("/api/sale",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:total,method,items:cart})});total=0;cart=[];$("total").textContent="0";alert("Продажа проведена");dashboard();warehouse()}
$("cashPay").onclick=()=>sale("cash");$("cardPay").onclick=()=>sale("card");$("clear").onclick=()=>{total=0;cart=[];$("total").textContent="0"};
async function move(type){
  let a;
  let reason="";
  if(type==="cash_in"){
    a=Number(prompt("Сколько внести?"));
    if(!a)return;
  }else{
    a=Number(prompt("Сколько изъять из кассы?"));
    if(!a)return;
    reason=prompt("Куда уходят деньги?\nНапример: закупка продуктов, зарплата, аренда, доставка");
    if(reason===null)return;
    reason=reason.trim();
    if(!reason)return alert("Укажите, куда уходят деньги");
  }
  await fetch("/api/cash",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({amount:a,type,reason})
  });
  alert("Сохранено");
  dashboard();
}$("in").onclick=()=>move("cash_in");$("out").onclick=()=>move("cash_out");
async function ops(){const d=await fetch("/api/dashboard").then(r=>r.json());$("opsList").innerHTML=d.operations.length?d.operations.map(row).join(""):"Операций пока нет"}
async function expenses(){
  const d=await fetch("/api/dashboard").then(r=>r.json());
  const list=d.operations.filter(o=>o.type==="cash_out");
  const total=list.reduce((s,o)=>s+o.amount,0);
  $("expenseTotal").textContent=money(total)+" сум";
  $("expenseList").innerHTML=list.length?list.map(o=>`
    <div class="row">
      <span><b>${o.reason||"Без указания причины"}</b><br><small>${o.time}</small></span>
      <b style="color:#dc3545">−${money(o.amount)} сум</b>
    </div>`).join(""):"Расходов пока нет";
}

$("addProduct").onclick=async()=>{
  const name=$("newProductName").value.trim();
  const price=Number($("newProductPrice").value);
  if(!name||!price||price<0){alert("Введите название и корректную цену");return}
  const r=await fetch("/api/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,price})});
  const d=await r.json();
  if(!r.ok){alert(d.error||"Не удалось добавить товар");return}
  $("newProductName").value="";
  $("newProductPrice").value="";
  alert("Товар добавлен");
  goods();
  loadProducts();
};

async function warehouse(){
  const items=await fetch("/api/warehouse").then(r=>r.json());
  $("warehouseList").innerHTML=items.length?items.map(x=>`
    <div class="row">
      <span><b>${x.name}</b><br><small>Остаток: ${x.quantity} ${x.unit}</small></span>
      <span>
        <button onclick="editWarehouse(${x.id})">✏️ Изменить</button>
        <button class="red" onclick="deleteWarehouse(${x.id},'${x.name.replace(/'/g,"\\'")}')">🗑️ Удалить</button>
      </span>
    </div>`).join(""):"Склад пока пуст";
}
$("warehouseAdd").onclick=async()=>{
  const name=$("warehouseName").value.trim(),quantity=Number($("warehouseQty").value),unit=$("warehouseUnit").value.trim()||"шт";
  if(!name||!Number.isFinite(quantity)||quantity<0){alert("Введите название и количество");return}
  const r=await fetch("/api/warehouse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,quantity,unit})});
  const d=await r.json();if(!r.ok){alert(d.error);return}
  $("warehouseName").value="";$("warehouseQty").value="";$("warehouseUnit").value="шт";warehouse();
};
async function editWarehouse(id){
  const items=await fetch("/api/warehouse").then(r=>r.json()),x=items.find(i=>i.id===id);if(!x)return;
  const name=prompt("Название:",x.name);if(name===null)return;
  const quantity=Number(prompt("Количество:",x.quantity));if(!Number.isFinite(quantity)||quantity<0){alert("Некорректное количество");return}
  const unit=prompt("Единица:",x.unit);if(unit===null||!unit.trim())return;
  const r=await fetch("/api/warehouse/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,quantity,unit})});
  const d=await r.json();if(!r.ok){alert(d.error);return}warehouse();
}
async function deleteWarehouse(id,name){
  if(!confirm("Удалить «"+name+"» со склада?"))return;
  const r=await fetch("/api/warehouse/"+id,{method:"DELETE"});const d=await r.json();
  if(!r.ok){alert(d.error);return}warehouse();
}

async function recipes(){
  const [products,stocks,current]=await Promise.all([
    fetch("/api/products").then(r=>r.json()),
    fetch("/api/warehouse").then(r=>r.json()),
    fetch("/api/recipes").then(r=>r.json())
  ]);
  $("recipeProductSelect").innerHTML=`<label>Товар: <select id="recipeProduct" class="form-input">${products.map((p,i)=>`<option value="${p.id||i+1}">${p.name}</option>`).join("")}</select></label>`;
  $("recipeProduct").onchange=()=>renderRecipeEditor(products,stocks,current);
  renderRecipeEditor(products,stocks,current);
}
function renderRecipeEditor(products,stocks,current){
  const pid=Number($("recipeProduct").value), rows=current.filter(r=>Number(r.productId)===pid);
  $("recipeEditor").innerHTML=`
    <h3>Состав и списание</h3>
    <div id="recipeRows">${stocks.map(s=>{
      const r=rows.find(x=>Number(x.warehouseId)===Number(s.id));
      return `<div class="row"><span>${s.name} (${s.unit})</span><input class="recipeQty form-input" data-wid="${s.id}" type="number" min="0" step="0.01" value="${r?r.quantity:0}" style="max-width:180px"></div>`;
    }).join("")}</div>
    <button id="saveRecipe" class="green">💾 Сохранить рецепт</button>`;
  $("saveRecipe").onclick=saveRecipe;
}
async function saveRecipe(){
  const productId=Number($("recipeProduct").value);
  const items=[...document.querySelectorAll(".recipeQty")].map(x=>({warehouseId:Number(x.dataset.wid),quantity:Number(x.value)})).filter(x=>x.quantity>0);
  const r=await fetch("/api/recipes/"+productId,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});
  const d=await r.json();if(!r.ok){alert(d.error||"Ошибка");return}alert("Рецепт сохранён");
}
