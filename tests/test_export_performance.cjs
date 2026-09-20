const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../app/templates/index.html','utf8');
const library=fs.readFileSync(__dirname+'/../app/static/journey_export.js','utf8');
function setup(){const c=vm.createContext({});vm.runInContext(library,c);return c;}
function data(tracks){
 const legs=Array.from({length:Math.max(0,...tracks.map(t=>t.leg))+1},(_,i)=>({path:tracks.filter(t=>t.leg===i).map(t=>({way_id:t.id}))}));
 return {legs,total_path_coords:tracks,total_path:legs.flatMap(l=>l.path)};
}
test('6512 条轨道距离缓存：重复汇总不重算、新增/截断只算变化轨道、退回及清空正确',()=>{
 const c=setup();let calls=0;
 const totals=c.createJourneyDistanceCache((a,b)=>{calls++;return Math.hypot(a[0]-b[0],a[1]-b[1])*1000});
 const tracks=Array.from({length:6512},(_,i)=>({id:i,leg:i<3000?0:1,coords:[[i,0],[i+1,0]]}));
 const first=data(tracks),result=totals(first);
 assert.equal(result.total,6512000);assert.equal(result.legs[0],3000000);assert.equal(calls,6512);
 assert.equal(totals(first),result);assert.equal(calls,6512);
 totals(data(structuredClone(tracks)));assert.equal(calls,6512);
 const extended=[...tracks,{id:6512,leg:1,coords:[[6512,0],[6513,0]]}];
 assert.equal(totals(data(extended)).total,6513000);assert.equal(calls,6513);
 const cut=structuredClone(extended);cut.at(-1).coords[1]=[6512.5,0];
 assert.equal(totals(data(cut)).total,6512500);assert.equal(calls,6514);
 assert.equal(totals(first).total,6512000);assert.equal(calls,6514);
 assert.equal(totals({legs:[],total_path_coords:[]}).total,0);
 const replacement=data([{id:0,leg:0,coords:[[0,0],[2,0]]}]);
 assert.equal(totals(replacement).total,2000);assert.equal(calls,6515);
});
test('同一 way 的不同截断部分分别计长，换行程段不沿用旧的段汇总',()=>{
 const c=setup(),totals=c.createJourneyDistanceCache((a,b)=>Math.abs(a[0]-b[0]));
 const tracks=[{id:1,leg:0,coords:[[0,0],[1,0]]},{id:1,leg:1,coords:[[1,0],[3,0]]}];
 assert.equal(JSON.stringify(totals(data(tracks)).legs),'[1,2]');
 tracks[0]={...tracks[0],leg:1};
 assert.equal(JSON.stringify(totals(data(tracks)).legs),'[0,3]');
});
test('Overpass 普通更新不生成、不写文本框；查看时按最新范围生成，保留去重及截断提醒',async()=>{
 const elements={};let writes=0,builds=0;
 const element=id=>elements[id] ||= {value:'',dataset:{},hidePopover(){}};
 Object.defineProperty(element('overpass-query'),'value',{get(){return this.text||''},set(v){writes++;this.text=v}});
 const c=setup();c.document={getElementById:element};c.L={latLng:a=>({distanceTo:b=>0})};c.clearCopyNotices=()=>{};
 const original=c.journeyOverpass;c.journeyOverpass=(...args)=>{builds++;return original(...args)};
 vm.runInContext(source.slice(source.indexOf('    const distanceTotals ='),source.indexOf('    const kmlDialog')),c);
 const first={legs:[{path:[{way_id:1},{way_id:1,span:[0,.5]}]},{path:[{way_id:2}]}],total_path:[{way_id:1},{way_id:1,span:[0,.5]},{way_id:2}],total_path_coords:[]};
 element('export-scope').value='all';
 for(let i=0;i<64;i++)c.updateExportControls(first);
 assert.equal(builds,0);assert.equal(writes,0);
 let r=c.prepareOverpassQuery();assert.equal(r.partial,true);assert.equal((r.query.match(/way\(1\)/g)||[]).length,1);assert(r.query.includes('way(2)'));assert.equal(writes,1);
 c.prepareOverpassQuery();assert.equal(writes,1);
 element('export-scope').value='1';c.updateExportControls(first);assert.equal(writes,1);
 r=c.prepareOverpassQuery();assert.equal(r.partial,false);assert(!r.query.includes('way(1)'));assert(r.query.includes('way(2)'));
 const next={legs:[{path:[{way_id:3}]}],total_path:[{way_id:3}],total_path_coords:[]};
 element('export-scope').value='all';c.updateExportControls(next);r=c.prepareOverpassQuery();assert(r.query.includes('way(3)'));assert(!r.query.includes('way(2)'));
 c.updateExportControls({legs:[],total_path:[],total_path_coords:[]});assert.equal(element('copy-query').disabled,true);assert.equal(c.prepareOverpassQuery().query,'');
 // 两个复制入口共用函数；校验剪贴板成功及失败时的手动复制退路。
 let copied='',opened=0,selected=0;
 c.moreActions={hidePopover(){}};c.showCopyNotice=()=>{};
 c.navigator={clipboard:{writeText:async text=>{copied=text}}};
 element('query-preview').showModal=()=>opened++;
 element('overpass-query').focus=()=>{};element('overpass-query').select=()=>selected++;
 vm.runInContext(source.slice(source.indexOf('    async function copyOverpassQuery()'),source.indexOf("    document.getElementById('copy-query').onclick")),c);
 c.updateExportControls(next);await c.copyOverpassQuery();assert(copied.includes('way(3)'));
 c.navigator.clipboard.writeText=async()=>{throw new Error('denied')};
 await c.copyOverpassQuery();assert.equal(opened,1);assert.equal(selected,1);
});
