const express=require("express"),fs=require("fs"),path=require("path");
const app=express();
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||"0.0.0.0";
const DATA_DIR=process.env.DATA_DIR||__dirname;
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
const DATA=path.join(DATA_DIR,"data.json");
const initial={users:[{username:"admin",password:"admin123",name:"Владелец"}],warehouse:[],recipes:[],products:[{name:"Капучино",price:25000},{name:"Латте",price:27000},{name:"Американо",price:18000},{name:"Эспрессо",price:15000},{name:"Мохито",price:22000},{name:"Чизкейк",price:30000}],operations:[]};
if(!fs.existsSync(DATA))fs.writeFileSync(DATA,JSON.stringify(initial,null,2));
const read=()=>{const d=JSON.parse(fs.readFileSync(DATA,"utf8"));if(!Array.isArray(d.warehouse))d.warehouse=[];return d},save=d=>fs.writeFileSync(DATA,JSON.stringify(d,null,2));
app.disable("x-powered-by");
app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(q,s)=>s.json({ok:true,service:"coffee-system-v5"}));
app.post("/api/login",(q,s)=>{const d=read(),u=d.users.find(x=>x.username===q.body.username&&x.password===q.body.password);if(!u)return s.status(401).json({error:"Неверный логин или пароль"});s.json({ok:true,user:u.name})});
app.get("/api/recipes",(q,s)=>s.json(read().recipes||[]));
app.put("/api/recipes/:productId",(q,s)=>{
  const d=read(),productId=Number(q.params.productId),items=Array.isArray(q.body.items)?q.body.items:[];
  d.recipes=(d.recipes||[]).filter(x=>Number(x.productId)!==productId);
  d.recipes.push(...items.map(x=>({productId,warehouseId:Number(x.warehouseId),quantity:Number(x.quantity)})));
  save(d);s.json({ok:true});
});
app.get("/api/warehouse",(q,s)=>s.json(read().warehouse));
app.post("/api/warehouse",(q,s)=>{
  const name=String(q.body.name||"").trim(), unit=String(q.body.unit||"шт").trim(), qty=Number(q.body.quantity);
  if(!name || !qty || qty<0) return s.status(400).json({error:"Введите название и количество"});
  const d=read();
  const item={id:d.warehouse.length?Math.max(...d.warehouse.map(x=>Number(x.id)||0))+1:1,name,unit,quantity:qty};
  d.warehouse.push(item); save(d); s.json({ok:true,item});
});
app.put("/api/warehouse/:id",(q,s)=>{
  const d=read(),id=Number(q.params.id),item=d.warehouse.find(x=>Number(x.id)===id);
  if(!item)return s.status(404).json({error:"Товар склада не найден"});
  const name=String(q.body.name||item.name).trim(),unit=String(q.body.unit||item.unit).trim(),qty=Number(q.body.quantity);
  if(!name || !unit || !Number.isFinite(qty) || qty<0)return s.status(400).json({error:"Некорректные данные"});
  item.name=name;item.unit=unit;item.quantity=qty;save(d);s.json({ok:true,item});
});
app.delete("/api/warehouse/:id",(q,s)=>{
  const d=read(),id=Number(q.params.id),before=d.warehouse.length;
  d.warehouse=d.warehouse.filter(x=>Number(x.id)!==id);
  if(d.warehouse.length===before)return s.status(404).json({error:"Товар склада не найден"});
  save(d);s.json({ok:true});
});
app.get("/api/products",(q,s)=>s.json(read().products));
app.post("/api/products",(q,s)=>{
  const name=String(q.body.name||"").trim(), price=Number(q.body.price);
  if(!name || !price || price<0) return s.status(400).json({error:"Введите название и корректную цену"});
  const d=read();
  const id=d.products.length ? Math.max(...d.products.map(x=>Number(x.id)||0))+1 : 1;
  const product={id,name,price};
  d.products.push(product);
  save(d);
  s.json({ok:true,product});
});
app.delete("/api/products/:id",(q,s)=>{
  const d=read(), id=Number(q.params.id);
  const before=d.products.length;
  d.products=d.products.filter((x,i)=>(Number(x.id)||i+1)!==id);
  if(d.products.length===before) return s.status(404).json({error:"Товар не найден"});
  save(d);
  s.json({ok:true});
});
app.put("/api/products/:id",(q,s)=>{
  const d=read(), id=Number(q.params.id), price=Number(q.body.price);
  const p=d.products.find((x,i)=>x.id===id || i+1===id);
  if(!p || !price || price<0) return s.status(400).json({error:"Некорректная цена"});
  p.price=price;
  save(d);
  s.json({ok:true,product:p});
});
app.get("/api/dashboard",(q,s)=>{const o=read().operations,sales=o.filter(x=>x.type==="sale").reduce((a,x)=>a+x.amount,0),cash=o.reduce((a,x)=>x.type==="sale"&&x.method==="cash"?a+x.amount:x.type==="cash_in"?a+x.amount:x.type==="cash_out"?a-x.amount:a,0),card=o.filter(x=>x.type==="sale"&&x.method==="card").reduce((a,x)=>a+x.amount,0);s.json({cash,sales,card,operations:o.slice(-30).reverse()})});
app.post("/api/sale",(q,s)=>{
  const a=Number(q.body.amount),m=q.body.method,items=Array.isArray(q.body.items)?q.body.items:[];
  if(!a||!["cash","card"].includes(m))return s.status(400).json({error:"Некорректная продажа"});
  const d=read(),recipes=d.recipes||[];
  const need={};
  for(const item of items){
    const recipe=recipes.filter(r=>Number(r.productId)===Number(item.productId));
    const qty=Number(item.quantity)||1;
    for(const r of recipe) need[r.warehouseId]=(need[r.warehouseId]||0)+r.quantity*qty;
  }
  for(const [wid,amount] of Object.entries(need)){
    const stock=d.warehouse.find(x=>Number(x.id)===Number(wid));
    if(!stock)return s.status(400).json({error:"Рецепт содержит отсутствующий товар склада"});
    if(Number(stock.quantity)<amount)return s.status(400).json({error:"Недостаточно на складе: "+stock.name+" (нужно "+amount+" "+stock.unit+")"});
  }
  for(const [wid,amount] of Object.entries(need)){
    const stock=d.warehouse.find(x=>Number(x.id)===Number(wid));
    stock.quantity=Number(stock.quantity)-amount;
  }
  d.operations.push({type:"sale",method:m,amount:a,items,time:new Date().toLocaleString("ru-RU")});
  save(d);s.json({ok:true,stockDeducted:need});
});
app.post("/api/cash",(q,s)=>{const a=Number(q.body.amount),t=q.body.type;if(!a||!["cash_in","cash_out"].includes(t))return s.status(400).json({error:"Некорректная сумма"});const d=read();d.operations.push({type:t,amount:a,reason:q.body.reason||"",time:new Date().toLocaleString("ru-RU")});save(d);s.json({ok:true})});
app.listen(PORT,HOST,()=>console.log(`Coffee System v5: http://${HOST}:${PORT}`));