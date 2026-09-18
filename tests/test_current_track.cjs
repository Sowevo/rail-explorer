const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JourneyEngine}=require('../app/static/journey_engine.js');
const template=fs.readFileSync(__dirname+'/../app/templates/index.html','utf8');
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';this.isConnected=true;this.classList={add(){},remove(){},toggle(){}};}
 append(...children){children.forEach(child=>this.appendChild(child));}
 appendChild(child){this.children.push(child);if(typeof child==='object')child.parent=this;}
 replaceChildren(){this.children.forEach(child=>{if(typeof child==='object')child.isConnected=false});this.children=[];}
 setAttribute(k,v){this.attributes[k]=v;}
 insertRow(){const row=new Element('tr');this.appendChild(row);row.insertCell=()=>{const cell=new Element('td');row.appendChild(cell);return cell};return row;}
 closest(){let el=this;while(el){if(el.className.includes('nearby-way-row'))return el;el=el.parent}return null;}
 querySelectorAll(selector){const out=[];const visit=node=>{for(const child of node.children||[]){if(typeof child!=='object')continue;
  if(selector==='button'&&child.tag==='button'||selector.includes('data-relation-tip')&&'relationTip' in child.dataset)out.push(child);
  visit(child);}};visit(this);return out;}
}
function all(root){return root.children.flatMap(x=>typeof x==='object'?[x,...all(x)]:[])}
test('从当前轨道标题进入详情、选择关系、悬浮预览并整组加入，无需附近查询或换乘',async()=>{
 const store={ways:new Map(),coords:new Map(),nodeWays:new Map(),stops:new Set(),async ensure(){}};
 for(const [id,nodes] of [[1,[1,2]],[2,[2,3]],[3,[3,4]]]){
  store.ways.set(id,{nodes,meta:{tags:{name:'线路'}}});for(const n of nodes){store.coords.set(n,[35,139+n*.001]);store.nodeWays.set(n,[...(store.nodeWays.get(n)||[]),id])}
 }
 const engine=new JourneyEngine(store);let data=await engine.advance([],{way_id:1});data=await engine.advance(data.legs,{way_id:2},true);data.revision=2;
 const els=Object.fromEntries(['element-detail','query-results','query-status','current-track-title'].map(id=>[id,new Element()]));
 const buttons=()=>all(els['element-detail']).filter(el=>el.tag==='button');
 const doc={createElement:t=>new Element(t),createTextNode:t=>t,getElementById:id=>els[id],
  querySelectorAll(selector){if(selector.includes('#way-form'))return buttons();if(selector.startsWith('#query-results'))return [];
   if(selector.includes('data-relation-advance'))return buttons().filter(b=>'relationAdvance' in b.dataset);
   if(selector.includes('data-element-type="relation"'))return buttons().filter(b=>b.dataset.elementType==='relation');return [];},
  querySelector(selector){if(selector.startsWith('#query-results'))return null;
   return buttons().find(b=>String(b.dataset.relationAdvance)===selector.match(/="(\d+)"/)?.[1]);}};
 const coords=id=>store.ways.get(id).nodes.map(n=>store.coords.get(n));
 const relation={type:'relation',id:10,name:'测试关系',relation_type:'route',geometry:[coords(1),coords(2),coords(3)],geometry_meta:[{},{},{}],tags:{},members:[],memberships:[],ways:[{id:1},{id:2},{id:3}]};
 const paths=[];let nearbyQueries=0;
 const ctx={document:doc,lastData:data,selectedStartWay:99,typeNames:{rail:'铁路'},trackActionPending:false,cutControl:null,startControl:null,connectControl:null,
  updateUndoButton(){},map:{removeLayer(){},fitBounds(){throw Error('查看或悬浮不应移动地图')}},TRACK_STYLES:{preview:{}},previewLayer:null,relationHoverOwner:null,
  previewArrows:{clear(){},showTracks(){}},railPreviewDirection:()=>null,
  L:{polyline:coords=>coords,featureGroup:()=>({addTo(){return this},bindTooltip(){}})},
  clearNearbyQuery(){},renderWays:r=>{ctx.lastData=r},
  journeyApi:{
   read:async url=>{if(url.startsWith('/nearby'))nearbyQueries++;if(url.startsWith('/elements/relation'))return relation;
    assert.equal(url,'/elements/way/2');return {type:'way',id:2,name:'线路',geometry:[coords(2)],geometry_meta:[{}],tags:{},memberships:[relation]};},
   relationPreview:async()=>({...await engine.relationPreview(ctx.lastData.legs,[1,2,3]),revision:ctx.lastData.revision}),
   advanceRelation:async payload=>{paths.push(payload);return {...await engine.advanceRelation(ctx.lastData.legs,[1,2,3]),revision:3}}
  }};
 vm.createContext(ctx);
 vm.runInContext(template.slice(template.indexOf('    async function runTrackAction('),template.indexOf('    const typeNames')),ctx);
 vm.runInContext(template.slice(template.indexOf('    function clearPreview('),template.indexOf('    async function queryNearby(')),ctx);
 const start=template.indexOf("    document.getElementById('current-track-title').onclick");
 vm.runInContext(template.slice(start,template.indexOf('    const undoButton',start)),ctx);
 await els['current-track-title'].onclick();
 assert.equal(ctx.selectedStartWay,null,'当前轨道详情不能当成换乘起点');
 assert.ok(all(els['element-detail']).some(el=>el.textContent==='直接所属关系'));
 assert.equal(buttons().some(b=>b.dataset.tooltip==='作为下一段继续'),false);
 const heading=els['element-detail'].children[0];
 const relationButton=buttons().find(b=>b.dataset.elementType==='relation');await relationButton.onclick();
 assert.equal(els['element-detail'].children[0],heading,'关系预览不替换轨道详情');
 const advance=buttons().find(b=>'relationAdvance' in b.dataset);assert.equal(advance.disabled,false);
 advance.parent.onmouseenter();assert.equal(ctx.relationHoverOwner,advance);advance.parent.onmouseleave();
 await advance.onclick();assert.equal(paths.length,1);assert.equal(ctx.lastData.current_way,3);assert.equal(ctx.lastData.legs.length,1);
 assert.equal(nearbyQueries,0);assert.equal(paths[0].anchor_way,2);assert.equal(paths[0].revision,2);
});
