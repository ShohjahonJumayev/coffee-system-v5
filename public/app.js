const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("ru-RU").format(Number(n || 0));

let total = 0;
let cart = [];

const loginEl = $("login");
const appEl = $("app");
const sidebar = $("sidebar");
const overlay = $("overlay");
const menuToggle = $("menuToggle");

function setError(text){ $("msg").textContent = text || ""; }

function openMenu(){
  if(window.innerWidth <= 820){
    sidebar.classList.add("open");
    overlay.classList.add("show");
  }
}
function closeMenu(){
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}
function toggleMenu(){
  if(sidebar.classList.contains("open")) closeMenu();
  else openMenu();
}
if(menuToggle) menuToggle.onclick = toggleMenu;
if(overlay) overlay.onclick = closeMenu;

$("loginBtn").onclick = login;
$("u").onkeydown = (e) => { if(e.key === "Enter") login(); };
$("p").onkeydown = (e) => { if(e.key === "Enter") login(); };
$("logout").onclick = () => location.reload();

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    showPage(btn.dataset.page);
  };
});

function showApp(){
  loginEl.classList.add("hide");
  appEl.classList.remove("hide");
  showPage("dash");
}

async function login(){
  setError("");
  try{
    const r = await fetch("/api/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        username: $("u").value.trim(),
        password: $("p").value
      })
    });
    const d = await r.json();
    if(!r.ok){
      setError(d.error || "Ошибка входа");
      return;
    }
    showApp();
  }catch(e){
    setError("Сервер не отвечает");
  }
}

function showPage(pageId){
  document.querySelectorAll(".page").forEach(p => p.classList.add("hide"));
  const page = $(pageId);
  if(page) page.classList.remove("hide");
  closeMenu();

  if(pageId === "dash") dashboard();
  if(pageId === "cash") loadProducts();
  if(pageId === "goods") goods();
  if(pageId === "warehouse") warehouse();
  if(pageId === "recipes") recipes();
  if(pageId === "ops") ops();
  if(pageId === "expenses") expenses();
}

function operationLabel(type){
  return {
    sale: "Продажа",
    cash_in: "Внесение",
    cash_out: "Изъятие"
  }[type] || type;
}

function rowOperation(o){
  const title = operationLabel(o.type) + (o.type === "cash_out" && o.reason ? " · " + o.reason : "");
  const sign = o.type === "cash_out" ? "−" : "+";
  return `
    <div class="list-item">
      <div>
        <div class="item-title">${title}</div>
        <div class="item-sub">${o.time || ""}${o.method ? " · " + o.method : ""}</div>
      </div>
      <div><b>${sign}${money(o.amount)} сум</b></div>
    </div>`;
}

async function dashboard(){
  const d = await fetch("/api/dashboard").then(r => r.json());
  $("cashSum").textContent = money(d.cash) + " сум";
  $("salesSum").textContent = money(d.sales) + " сум";
  $("cardSum").textContent = money(d.card) + " сум";
  $("recent").innerHTML = d.operations.length ? d.operations.map(rowOperation).join("") : `<div class="empty-state">Операций пока нет</div>`;
}

function renderCart(){
  $("total").textContent = money(total);
  $("cartCount").textContent = cart.reduce((s, x) => s + x.quantity, 0);
  if(!cart.length){
    $("cartList").innerHTML = `<div class="empty-state">Текущий чек пуст</div>`;
    return;
  }
  $("cartList").innerHTML = cart.map(item => `
    <div class="list-item">
      <div>
        <div class="item-title">${item.name}</div>
        <div class="item-sub">${item.quantity} × ${money(item.price)} сум</div>
      </div>
      <div class="item-actions">
        <button class="small-btn" onclick="changeCartQty(${item.productId}, -1)">−</button>
        <button class="small-btn" onclick="changeCartQty(${item.productId}, 1)">+</button>
        <button class="small-btn red" onclick="removeFromCart(${item.productId})">Удалить</button>
      </div>
    </div>
  `).join("");
}

window.changeCartQty = function(productId, delta){
  const item = cart.find(x => x.productId === productId);
  if(!item) return;
  item.quantity += delta;
  total += item.price * delta;
  if(item.quantity <= 0){
    cart = cart.filter(x => x.productId !== productId);
  }
  if(total < 0) total = 0;
  renderCart();
};

window.removeFromCart = function(productId){
  const item = cart.find(x => x.productId === productId);
  if(!item) return;
  total -= item.price * item.quantity;
  cart = cart.filter(x => x.productId !== productId);
  if(total < 0) total = 0;
  renderCart();
};

async function loadProducts(){
  const p = await fetch("/api/products").then(r => r.json());
  $("buttons").innerHTML = p.map((x, i) => `
    <div class="product-card" data-id="${x.id || i + 1}" data-name="${x.name}" data-price="${x.price}">
      <div class="product-name">${x.name}</div>
      <div class="product-price">${money(x.price)} сум</div>
    </div>
  `).join("");
  document.querySelectorAll(".product-card").forEach(card => {
    card.onclick = () => {
      const productId = Number(card.dataset.id);
      const name = card.dataset.name;
      const price = Number(card.dataset.price);
      const found = cart.find(x => x.productId === productId);
      if(found) found.quantity += 1;
      else cart.push({ productId, name, price, quantity: 1 });
      total += price;
      renderCart();
    };
  });
  renderCart();
}

async function sale(method){
  if(!cart.length) return alert("Выберите товар");
  const payload = {
    amount: total,
    method,
    items: cart.map(x => ({ productId: x.productId, quantity: x.quantity }))
  };
  const r = await fetch("/api/sale", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Не удалось провести продажу");
    return;
  }
  alert("Продажа проведена");
  total = 0;
  cart = [];
  renderCart();
  dashboard();
}
$("cashPay").onclick = () => sale("cash");
$("cardPay").onclick = () => sale("card");
$("clear").onclick = () => {
  total = 0;
  cart = [];
  renderCart();
};

async function move(type){
  let a;
  let reason = "";
  if(type === "cash_in"){
    a = Number(prompt("Сколько внести?"));
    if(!a) return;
  }else{
    a = Number(prompt("Сколько изъять из кассы?"));
    if(!a) return;
    reason = prompt("Куда уходят деньги?\nНапример: закупка продуктов, зарплата, аренда");
    if(reason === null) return;
    reason = reason.trim();
    if(!reason) return alert("Укажите, куда уходят деньги");
  }
  await fetch("/api/cash", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ amount: a, type, reason })
  });
  alert("Сохранено");
  dashboard();
}
$("in").onclick = () => move("cash_in");
$("out").onclick = () => move("cash_out");

async function ops(){
  const d = await fetch("/api/dashboard").then(r => r.json());
  $("opsList").innerHTML = d.operations.length ? d.operations.map(rowOperation).join("") : `<div class="empty-state">Операций пока нет</div>`;
}

async function expenses(){
  const d = await fetch("/api/dashboard").then(r => r.json());
  const list = d.operations.filter(o => o.type === "cash_out");
  const totalExpenses = list.reduce((s, o) => s + Number(o.amount || 0), 0);
  $("expenseTotal").textContent = money(totalExpenses) + " сум";
  $("expenseList").innerHTML = list.length ? list.map(o => `
    <div class="list-item">
      <div>
        <div class="item-title">${o.reason || "Без указания причины"}</div>
        <div class="item-sub">${o.time || ""}</div>
      </div>
      <div><b style="color:#b91c1c">−${money(o.amount)} сум</b></div>
    </div>
  `).join("") : `<div class="empty-state">Расходов пока нет</div>`;
}

$("addProduct").onclick = async () => {
  const name = $("newProductName").value.trim();
  const price = Number($("newProductPrice").value);
  if(!name || !price || price < 0){
    alert("Введите название и корректную цену");
    return;
  }
  const r = await fetch("/api/products", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, price })
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Не удалось добавить товар");
    return;
  }
  $("newProductName").value = "";
  $("newProductPrice").value = "";
  alert("Товар добавлен");
  goods();
};

async function goods(){
  const p = await fetch("/api/products").then(r => r.json());
  $("goodsList").innerHTML = p.length ? p.map((x, i) => `
    <div class="list-item">
      <div>
        <div class="item-title">${x.name}</div>
        <div class="item-sub">Текущая цена: ${money(x.price)} сум</div>
      </div>
      <div class="item-actions">
        <button class="small-btn dark" onclick="editPrice(${x.id || i + 1}, '${String(x.name).replace(/'/g, "\\'")}', ${x.price})">Изменить</button>
        <button class="small-btn red" onclick="deleteProduct(${x.id || i + 1}, '${String(x.name).replace(/'/g, "\\'")}')">Удалить</button>
      </div>
    </div>
  `).join("") : `<div class="empty-state">Товаров пока нет</div>`;
}

window.deleteProduct = async function(id, name){
  if(!confirm("Удалить товар «" + name + "»?")) return;
  const r = await fetch("/api/products/" + id, { method: "DELETE" });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Не удалось удалить товар");
    return;
  }
  alert("Товар удалён");
  goods();
  loadProducts();
};

window.editPrice = async function(id, name, current){
  const value = prompt("Новая цена для «" + name + "»:", current);
  if(value === null) return;
  const price = Number(value);
  if(!price || price < 0){
    alert("Введите корректную цену");
    return;
  }
  const r = await fetch("/api/products/" + id, {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ price })
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Не удалось изменить цену");
    return;
  }
  alert("Цена изменена");
  goods();
  loadProducts();
};

async function warehouse(){
  const items = await fetch("/api/warehouse").then(r => r.json());
  $("warehouseList").innerHTML = items.length ? items.map(x => `
    <div class="list-item">
      <div>
        <div class="item-title">${x.name}</div>
        <div class="item-sub">Остаток: ${x.quantity} ${x.unit}</div>
      </div>
      <div class="item-actions">
        <button class="small-btn dark" onclick="editWarehouse(${x.id})">Изменить</button>
        <button class="small-btn red" onclick="deleteWarehouse(${x.id}, '${String(x.name).replace(/'/g, "\\'")}')">Удалить</button>
      </div>
    </div>
  `).join("") : `<div class="empty-state">Склад пока пуст</div>`;
}

$("warehouseAdd").onclick = async () => {
  const name = $("warehouseName").value.trim();
  const quantity = Number($("warehouseQty").value);
  const unit = $("warehouseUnit").value.trim() || "шт";
  if(!name || !Number.isFinite(quantity) || quantity < 0){
    alert("Введите название и количество");
    return;
  }
  const r = await fetch("/api/warehouse", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, quantity, unit })
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Ошибка");
    return;
  }
  $("warehouseName").value = "";
  $("warehouseQty").value = "";
  $("warehouseUnit").value = "шт";
  warehouse();
};

window.editWarehouse = async function(id){
  const items = await fetch("/api/warehouse").then(r => r.json());
  const x = items.find(i => Number(i.id) === Number(id));
  if(!x) return;
  const name = prompt("Название:", x.name);
  if(name === null) return;
  const quantity = Number(prompt("Количество:", x.quantity));
  if(!Number.isFinite(quantity) || quantity < 0){
    alert("Некорректное количество");
    return;
  }
  const unit = prompt("Единица:", x.unit);
  if(unit === null || !unit.trim()) return;

  const r = await fetch("/api/warehouse/" + id, {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, quantity, unit })
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Ошибка");
    return;
  }
  warehouse();
};

window.deleteWarehouse = async function(id, name){
  if(!confirm("Удалить «" + name + "» со склада?")) return;
  const r = await fetch("/api/warehouse/" + id, { method: "DELETE" });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Ошибка");
    return;
  }
  warehouse();
};

async function recipes(){
  const [products, stocks, current] = await Promise.all([
    fetch("/api/products").then(r => r.json()),
    fetch("/api/warehouse").then(r => r.json()),
    fetch("/api/recipes").then(r => r.json())
  ]);

  $("recipeProductSelect").innerHTML = `
    <label class="item-sub">Товар</label>
    <select id="recipeProduct" class="input">
      ${products.map((p, i) => `<option value="${p.id || i + 1}">${p.name}</option>`).join("")}
    </select>`;

  $("recipeProduct").onchange = () => renderRecipeEditor(stocks, current);
  renderRecipeEditor(stocks, current);
}

function renderRecipeEditor(stocks, current){
  const pid = Number($("recipeProduct").value);
  const rows = current.filter(r => Number(r.productId) === pid);
  $("recipeEditor").innerHTML = `
    <div style="margin-top:16px">
      ${stocks.length ? stocks.map(s => {
        const r = rows.find(x => Number(x.warehouseId) === Number(s.id));
        return `
          <div class="recipe-row">
            <div>
              <div class="item-title">${s.name}</div>
              <div class="item-sub">Единица: ${s.unit}</div>
            </div>
            <input class="input recipeQty" data-wid="${s.id}" type="number" min="0" step="0.01" value="${r ? r.quantity : 0}">
          </div>`;
      }).join("") : `<div class="empty-state">Сначала добавь позиции на склад</div>`}
    </div>
    <div class="action-row" style="margin-top:16px">
      <button id="saveRecipe" class="btn btn-primary">Сохранить рецепт</button>
    </div>`;

  const saveBtn = $("saveRecipe");
  if(saveBtn) saveBtn.onclick = saveRecipe;
}

async function saveRecipe(){
  const productId = Number($("recipeProduct").value);
  const items = [...document.querySelectorAll(".recipeQty")]
    .map(x => ({ warehouseId: Number(x.dataset.wid), quantity: Number(x.value) }))
    .filter(x => x.quantity > 0);

  const r = await fetch("/api/recipes/" + productId, {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ items })
  });
  const d = await r.json();
  if(!r.ok){
    alert(d.error || "Ошибка");
    return;
  }
  alert("Рецепт сохранён");
}
