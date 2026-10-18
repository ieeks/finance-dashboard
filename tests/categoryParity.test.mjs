import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import { CARD_CONFIG } from '../js/state.js';
import { ALL_SUBCATEGORIES, SUBCAT_ALIASES, SUBCAT_ITEM_RULES, normalizeSubcategory, SUBCAT_ICONS } from '../js/categories.js';
import { resolveItemCategory, itemNameKey, learnedCategory, withLearnedCategory, linkedBon, planCategoryRepair, bonSnapshot } from '../js/bonCategories.js';

const samples = [
  { name:'Schärdinger Gouda', subcategory:'Sonstiges', gesamt:2.37 },
  { name:'PERSIL WASCHMITTELPULVER', subcategory:'Waschmittel', gesamt:9.99 },
  { name:'Cornetto MAX Pistachio', subcategory:'Sonstiges', gesamt:6.99 },
  { name:'ESN ISOCLEAR WHEY', subcategory:'Sonstiges' },
  { name:'Protein Mousse 200G', subcategory:'Sonstiges' },
  { name:'Billa FL Eier M 10er', subcategory:'Sonstiges' },
  { name:'Verival Maiswaffel', subcategory:'Sonstiges' },
  { name:'rotho kühlschrankbox 3.1l kunststoff', subcategory:'Sonstiges' },
  { name:'zuru x-shot water blaster', subcategory:'Sonstiges' },
  { name:'VICI STI.FLO', subcategory:'Unklare Kategorie' },
  ...['Phil. Natur','BAHL.PICK UP 5ER','DR. BECKMANN FRISCHEDUFT','Dress. Prem 300ML'].map(name => ({name,subcategory:'Sonstiges'})),
  { name:'Zuckermais', subcategory:'Sonstiges' },
  { name:'Magnum Kopfhörer', subcategory:'Sonstiges' },
  { name:'AXE DUSCHE', subcategory:'Hygiene & Drogerie' },
];

test('Python and JS categories, aliases, rules and normalization stay in sync', () => {
  const values=['milchprodukte',' Milchprodukte / Käse ','Hygiene&Drogerie','Tiefkühlprodukte','Waschmittel','Unbekannt','',null];
  const py = execFileSync('python', ['-c', `import json,sys
from tests.test_python_importer import H
v=json.load(sys.stdin)
print(json.dumps({'categories':H['SUBCATEGORIES'],'aliases':H['_SUBCAT_ALIASES'],'rules':H['_SUBCAT_ITEM_RULES'],'normalized':[H['_normalize_subcategory'](s) for s in v['values']],'items':[H['_item_category_fields'](s) for s in v['samples']]},ensure_ascii=False))`], { input:JSON.stringify({values,samples}), encoding:'utf8' });
  const result=JSON.parse(py);
  assert.deepEqual([...result.categories].sort(), [...ALL_SUBCATEGORIES].sort());
  assert.deepEqual(result.aliases, SUBCAT_ALIASES);
  assert.deepEqual(result.rules, SUBCAT_ITEM_RULES);
  assert.deepEqual(result.normalized, values.map(normalizeSubcategory));
  for(let i=0;i<samples.length;i++) {
    const js=resolveItemCategory(samples[i],{},true);
    for(const [key,value] of Object.entries(result.items[i])) assert.deepEqual(js[key],value,`${samples[i].name}: ${key}`);
    assert.equal(js.gesamt,samples[i].gesamt);
  }
  const prompt=fs.readFileSync(new URL('../prompts/analyze-bon.md',import.meta.url),'utf8');
  for(const label of ALL_SUBCATEGORIES) assert.ok(prompt.includes(`**${label}**`),`Prompt missing ${label}`);
});

test('Known labels normalize, unknown labels retain raw value', () => {
  assert.equal(normalizeSubcategory('milchprodukte'),'Milchprodukte');
  const item=resolveItemCategory({name:'?',subcategory:'Unbekannte Warengruppe'}, {}, true);
  assert.equal(item.subcategory,'Unbekannte Warengruppe');
  assert.equal(item.subcategoryRaw,'Unbekannte Warengruppe');
  assert.equal(item.subcategoryNeedsReview,true);
});

test('Only safe item-name cleanup; conflicting learned keys require clarification', () => {
  assert.equal(itemNameKey(' @  Knabber  Nossi Snack Box '),'knabber nossi snack box');
  assert.notEqual(itemNameKey('Cornetto 6er'),itemNameKey('Cornetto 8er'));
  const ov={'@ Artikel':'Tiefkühl','artikel':'Süßwaren / Naschen'};
  assert.equal(learnedCategory('Artikel',ov),null);
  assert.equal(resolveItemCategory({name:'Gouda',subcategory:'Sonstiges'}, {'Gouda':'Tiefkühl','@ Gouda':'Milchprodukte'}, true).subcategory,'Sonstiges');
  assert.equal(learnedCategory('Artikel',withLearnedCategory(ov,'Artikel','Tiefkühl')),'Tiefkühl');
});

test('Manual categories and already concrete AI categories win over heuristics', () => {
  assert.equal(resolveItemCategory({name:'Gouda',subcategory:'Sonstiges',subcategorySource:'manual'}, {}, true).subcategory,'Sonstiges');
  assert.equal(resolveItemCategory({name:'Gouda',subcategory:'Restaurant'}, {}, true).subcategory,'Restaurant');
});

test('Ambiguous items are not guessed; protein dessert is not sports nutrition', () => {
  for(const name of ['VICI STI.FLO','LA FIESTA 8ER','Zuckermais','Magnum Kopfhörer'])
    assert.equal(resolveItemCategory({name,subcategory:'Sonstiges'},{},true).subcategory,'Sonstiges',name);
  assert.equal(resolveItemCategory({name:'PROTEIN MOUSSE 200G',subcategory:'Sonstiges'},{},true).subcategory,'Süßwaren / Naschen');
});

const bon=()=>({source:'gmail_import',total:2.37,date:'2026-10-01',items:[{name:'Schärdinger Gouda',price:2.37,menge:1,subcategory:'Sonstiges'}]});
const invoice=()=>({id:'gmail',source:'gmail_import',date:'2026-10-01',amount:-2.37,description:'Billa',bon:bon()});

test('Gmail linking uses learned categories without changing the source object', () => {
  const gmail=invoice(), original=structuredClone(gmail);
  const linked=linkedBon(gmail,{'schärdinger gouda':'Milchprodukte'});
  assert.equal(linked.items[0].subcategory,'Milchprodukte');
  assert.equal(linked.invoiceId,'gmail');
  linked.items[0].name='edited';
  assert.deepEqual(gmail,original);
});

test('Existing Sonstiges remains unchanged by auto-link until repair confirmation', () => {
  assert.equal(linkedBon(invoice()).items[0].subcategory,'Sonstiges');
});

test('Repair preview covers sources, copies and pending; leaves amounts and manual items untouched', () => {
  const gmail=invoice();
  const bank={id:'bank',description:'Billa',bon:linkedBon(gmail)};
  const pending={id:'pending',total:5,items:[{name:'Eier M 10er',gesamt:5,subcategory:'Sonstiges'}]};
  const manual={id:'manual',bon:{items:[{name:'Gouda',price:20,subcategory:'Sonstiges',subcategorySource:'manual'}]}};
  const input=[gmail,bank,manual], copy=structuredClone(input);
  const plan=planCategoryRepair(input,[pending]);
  assert.equal(plan.changes.length,3);
  assert.equal(plan.rows.length,2);
  assert.deepEqual(input,copy);
  for(const change of plan.changes) {
    assert.equal(change.after.total,change.before.total);
    for(let i=0;i<change.before.items.length;i++) {
      for(const key of ['price','gesamt','menge']) assert.equal(change.after.items[i][key],change.before.items[i][key]);
    }
  }
  const repaired=plan.changes.filter(c=>c.collection==='transactions').map(c=>({id:c.id,bon:c.after}));
  assert.equal(planCategoryRepair(repaired,[]).changes.length,0);
});

// Exercise the actual app handlers and Firestore commit wrapper without a network.
const appSource=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const serviceSource=fs.readFileSync(new URL('../js/firebaseService.js',import.meta.url),'utf8');
function section(start,end) {
  const a=appSource.indexOf(start), b=appSource.indexOf(end,a);
  assert.ok(a>=0&&b>a,`source section ${start}`);
  return appSource.slice(a,b);
}
function scenario() {
  const stored=new Map([['household/main/transactions/gmail',invoice()],['household/main/transactions/bank',{id:'bank',date:'2026-10-01',amount:-2.37,description:'Billa'}]]);
  const logs=[];
  let fail=false;
  const ctx={console,structuredClone,window:{openTxModal(){}},SUBCAT_ICONS,
    state:{transactions:[...stored.values()].map(v=>structuredClone(v)),subcategoryOverrides:{}},
    linkedBon,itemNameKey,bonSnapshot,withLearnedCategory,resolveItemCategory,
    findMatch:(_bon,pool)=>({transaction:pool[0]}),
    updateTx:async(id,patch)=>Object.assign(stored.get(`household/main/transactions/${id}`),structuredClone(patch)),
    saveState(){},renderDashboard(){},showToast:message=>logs.push(message),db:{},HH:'household/main',
    doc:(_db,path,id)=>`${path}/${id}`,
    runTransaction:async(_db,fn)=>{
      if(fail) throw Error('permission-denied');
      const writes=[];
      const value=await fn({get:async ref=>({exists:()=>stored.has(ref),data:()=>structuredClone(stored.get(ref))}),
        update:(ref,patch)=>writes.push(()=>{for(const [key,v] of Object.entries(patch)) {
          if(key==='bon.items') stored.get(ref).bon.items=structuredClone(v);
          else stored.get(ref)[key]=structuredClone(v);
        }}),set:(ref,value)=>writes.push(()=>stored.set(ref,structuredClone(value)))});
      writes.forEach(write=>write());
      return value;
    }};
  vm.createContext(ctx);
  vm.runInContext(serviceSource.slice(serviceSource.indexOf('export async function commitBonCategoryChanges')).replace('export ',''),ctx);
  vm.runInContext(section('let _categorySaveBusy','// Preview covers')+'\n'+section('function _autoLinkGmailBons()', '\nfunction _initApp'),ctx);
  return {ctx,stored,logs,setFail:value=>{fail=value;}};
}

test('Regression: manual correction survives reload and Gmail re-link', async()=>{
  const {ctx,stored,logs}=scenario();
  ctx._autoLinkGmailBons();
  await ctx.window.updateBonItemSubcat('bank',0,'Milchprodukte');
  assert.equal(logs.at(-1),'Subkategorie geändert & gemerkt');
  for(const id of ['gmail','bank']) assert.equal(stored.get(`household/main/transactions/${id}`).bon.items[0].subcategory,'Milchprodukte');
  ctx.state.transactions=['gmail','bank'].map(id=>structuredClone(stored.get(`household/main/transactions/${id}`)));
  ctx.state.subcategoryOverrides=structuredClone(stored.get('household/main/config/subcategoryOverrides').overrides);
  ctx._autoLinkGmailBons();
  assert.equal(ctx.state.transactions[1].bon.items[0].subcategory,'Milchprodukte');
});

test('Regression: rejected saves produce no success, no local mutation and no partial learning',async()=>{
  const {ctx,stored,logs,setFail}=scenario();
  ctx._autoLinkGmailBons();
  const before=bonSnapshot(ctx.state.transactions);
  setFail(true);
  await ctx.window.updateBonItemSubcat('bank',0,'Milchprodukte');
  assert.ok(logs.at(-1).startsWith('Nicht gespeichert:'));
  assert.equal(bonSnapshot(ctx.state.transactions),before);
  assert.equal(stored.has('household/main/config/subcategoryOverrides'),false);
});

test('Stale preview aborts all writes including learning',async()=>{
  const {ctx,stored}=scenario();
  const before=structuredClone(stored.get('household/main/transactions/gmail').bon);
  stored.get('household/main/transactions/gmail').bon.items[0].price=3;
  await assert.rejects(ctx.commitBonCategoryChanges([{collection:'transactions',id:'gmail',before,after:{...before,items:[]}}],{name:'Gouda',category:'Milchprodukte'}),/inzwischen geändert/);
  assert.equal(stored.get('household/main/transactions/gmail').bon.items[0].price,3);
  assert.equal(stored.has('household/main/config/subcategoryOverrides'),false);
});

test('Repair commit only updates item categories and preserves invoice total and other fields',async()=>{
  const {ctx,stored}=scenario();
  const gmail=stored.get('household/main/transactions/gmail');
  const plan=planCategoryRepair([gmail],[]);
  await ctx.commitBonCategoryChanges(plan.changes);
  assert.equal(gmail.bon.items[0].subcategory,'Milchprodukte');
  assert.equal(gmail.bon.total,2.37);
  assert.equal(gmail.amount,-2.37);
});


test('Category repair excludes Tesla charging and non-shopping bills, including pending receipts', () => {
  const items=[{name:'Stromgebühr',subcategory:'Sonstiges',price:15}];
  const txs=[
    {id:'tesla',description:'Tesla Germany GmbH',category:'Online Shopping',bon:{items}},
    {id:'copy',description:'Kartenzahlung',bon:{store:'TESLA Germany GmbH',items}},
    {id:'charging',category:'Mobilität / Auto',bon:{items}},
    {id:'utility',category:'Energie / Strom',bon:{items}},
    {id:'shop',category:'Supermarkt',bon:{items:[{name:'Gouda',subcategory:'Sonstiges'}]}},
  ];
  const pending=[{id:'pending',vendor:'Tesla Austria GmbH',items}];
  const plan=planCategoryRepair(txs,pending,{'stromgebühr':'Dienstleistung'});
  assert.deepEqual(plan.changes.map(c=>c.id),['shop']);
  assert.equal(plan.rows[0].to,'Milchprodukte');
});

// A gated server models mobile latency: no read completes until all are started.
// This catches the previous serial loop without relying on timing thresholds.
test('Bulk repair starts all server reads before waiting and writes only after validation', async () => {
  const {ctx}=scenario();
  const pending=[], writes=[], progress=[];
  const before=bon();
  const changes=Array.from({length:148},(_,i)=>({collection:'transactions',id:`receipt-${i}`,before,
    after:{...before,items:[{...before.items[0],subcategory:'Milchprodukte'}]}}));
  ctx.runTransaction=async(_db,fn)=>fn({
    get:ref=>new Promise(resolve=>pending.push(()=>resolve({exists:()=>true,data:()=>ref.endsWith('/subcategoryOverrides')?{overrides:{}}:{bon:before}}))),
    update:(...args)=>writes.push(args),set:(...args)=>writes.push(args),
  });
  const save=ctx.commitBonCategoryChanges(changes,{name:'Gouda',category:'Milchprodukte'},p=>progress.push(p));
  assert.equal(pending.length,149,'148 receipts and learning must start together');
  assert.equal(writes.length,0);
  pending.splice(0).forEach(resolve=>resolve());
  await save;
  assert.equal(writes.length,149);
  assert.equal(progress.at(-1).phase,'saving');
  assert.equal(progress.at(-1).completed,148);
});

test('A failed parallel read prevents all category and learning writes', async () => {
  const {ctx}=scenario();
  let writes=0;
  ctx.runTransaction=async(_db,fn)=>fn({
    get:async ref=>{if(ref.endsWith('/bad')) throw Error('unavailable'); return {exists:()=>true,data:()=>({bon:bon()})};},
    update:()=>writes++,set:()=>writes++,
  });
  const changes=['ok','bad'].map(id=>({collection:'transactions',id,before:bon(),after:bon()}));
  await assert.rejects(ctx.commitBonCategoryChanges(changes),/unavailable/);
  assert.equal(writes,0);
});

test('Pending receipt ID added by the loader does not cause a false stale conflict', async () => {
  const {ctx,stored}=scenario();
  const pending=bon();
  stored.set('household/main/pendingBons/pending',pending);
  const plan=planCategoryRepair([],[{...pending,id:'pending'}]);
  await ctx.commitBonCategoryChanges(plan.changes);
  assert.equal(pending.items[0].subcategory,'Milchprodukte');
});

function repairUI() {
  const {ctx,logs}=scenario();
  const elements=new Map();
  let closed=false;
  ctx.document={getElementById:id=>{
    if(!elements.has(id)) elements.set(id,{hidden:false,disabled:false,textContent:'',style:{},
      classList:{add(){},remove(){closed=true;}}});
    return elements.get(id);
  }};
  Object.assign(ctx,{setInterval:()=>1,clearInterval(){},escHtml:String,planCategoryRepair});
  ctx.state.pendingBons=[];
  ctx.window.closeClearModal=()=>{};
  vm.runInContext(section('// Preview covers','// ── Clear / Settings Modal'),ctx);
  ctx.window.previewCategoryRepair();
  return {ctx,logs,elements,isClosed:()=>closed};
}

test('Save UI shows progress, prevents duplicate writes and closes only after confirmation',async()=>{
  const {ctx,elements,isClosed}=repairUI();
  let confirm,calls=0;
  ctx.commitBonCategoryChanges=(_changes,_learning,onProgress)=>{
    calls++;
    onProgress({phase:'checking',completed:1,total:148});
    return new Promise(resolve=>{confirm=resolve;});
  };
  const save=ctx.window.saveCategoryRepair();
  assert.equal(elements.get('category-repair-save').disabled,true);
  assert.equal(elements.get('category-repair-close').disabled,true);
  assert.match(elements.get('category-repair-status').textContent,/1 von 148/);
  await ctx.window.saveCategoryRepair();
  assert.equal(calls,1);
  assert.equal(isClosed(),false);
  assert.equal(ctx.state.transactions[0].bon.items[0].subcategory,'Sonstiges');
  confirm();
  await save;
  assert.equal(ctx.state.transactions[0].bon.items[0].subcategory,'Milchprodukte');
  assert.equal(isClosed(),true);
  assert.equal(elements.get('category-repair-save').disabled,false);
});

test('Save UI keeps failure visible and unlocks retry and close without local changes',async()=>{
  const {ctx,elements,isClosed,logs}=repairUI();
  let lateProgress;
  ctx.commitBonCategoryChanges=async(_changes,_learning,onProgress)=>{lateProgress=onProgress;throw Error('permission-denied');};
  await ctx.window.saveCategoryRepair();
  const status=elements.get('category-repair-status');
  assert.equal(status.hidden,false);
  lateProgress({phase:'checking',completed:2,total:148});
  assert.match(status.textContent,/Nicht gespeichert: permission-denied/);
  assert.equal(elements.get('category-repair-save').disabled,false);
  assert.equal(elements.get('category-repair-close').disabled,false);
  assert.equal(isClosed(),false);
  assert.equal(ctx.state.transactions[0].bon.items[0].subcategory,'Sonstiges');
  assert.ok(!logs.some(s=>s.endsWith('Zuordnungen gespeichert')));
});


test('Card account assignments match between browser configuration and importer', () => {
  const py=execFileSync('python',['-c',"import json; from tests.test_python_importer import H; print(json.dumps(H['CARD_ACCOUNT_MAP']))"],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(py),Object.fromEntries(Object.entries(CARD_CONFIG).map(([card,config])=>[card,config.accountId])));
});
