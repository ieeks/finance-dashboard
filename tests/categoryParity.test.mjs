import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
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
