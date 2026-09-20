const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function colours(){
 let canvases=0,contexts=0,parsed=0;
 const ctx={get fillStyle(){return this.colour},set fillStyle(v){parsed++;this.colour=({red:'#ff0000',blue:'#0000ff'})[v] || v}};
 const c=vm.createContext({CSS:{supports:(_,v)=>['red','blue','transparent'].includes(v)},
  document:{createElement:()=>{canvases++;return {getContext:()=>{contexts++;return ctx}}}}});
 vm.runInContext(fs.readFileSync(__dirname+'/../app/static/journey_export.js','utf8'),c);
 return {c,counts:()=>({canvases,contexts,parsed})};
}
test('6512 条无色轨道不创建 Canvas；重复色只解析一次、共享上下文',()=>{
 const {c,counts}=colours();
 for(let i=0;i<6512;i++)assert.equal(c.trackJourneyColour({},c.journeyColour({},1)),'#8e44ad');
 assert.equal(counts().canvases,0);
 assert.equal(c.normalizedJourneyColour('#F00'),'#ff0000');
 for(let i=0;i<6512;i++)assert.equal(c.normalizedJourneyColour('red'),'#ff0000');
 assert.deepEqual(counts(),{canvases:1,contexts:1,parsed:2});
 assert.equal(c.normalizedJourneyColour('blue'),'#0000ff');
 assert.equal(counts().contexts,1);
});
test('轨道色优先、等价关系色合并、冲突与无效色使用本段备用色',()=>{
 const {c}=colours(),resolve=meta=>c.trackJourneyColour({meta},'#8e44ad');
 assert.equal(resolve({tags:{colour:'#123456'},relation_colours:['red','blue']}),'#123456');
 assert.equal(resolve({relation_colours:['red','#f00']}),'#ff0000');
 assert.equal(resolve({relation_colours:['red','blue']}),'#8e44ad');
 assert.equal(resolve({tags:{colour:'bogus'},relation_colours:['blue']}),'#0000ff');
 assert.equal(resolve({relation_colours:['transparent','inherit','var(--x)']}),'#8e44ad');
});
test('同一行程跨线多色 KML 与地图取色一致，保留截断坐标和换乘断点',()=>{
 const {c}=colours();
 const tracks=[
  {id:1,leg:0,coords:[[1,1],[2,2]],meta:{tags:{colour:'#f00'}}},
  {id:2,leg:0,coords:[[2,2],[2.5,2.5]],meta:{relation_colours:['blue']}},
  {id:3,leg:0,coords:[[2.5,2.5],[3,3]],meta:{}},
  {id:4,leg:1,coords:[[8,8],[9,9]],meta:{}}];
 const data={legs:[{name:'直通'},{name:'换乘'}],total_path_coords:tracks};
 const kml=c.journeyKml(data,'all',data.legs.map(c.journeyColour));
 assert.equal((kml.match(/<Placemark>/g)||[]).length,4);
 for(const t of tracks){const hex=c.trackJourneyColour(t,c.journeyColour({},t.leg)).slice(1);assert(kml.includes('ff'+hex.slice(4,6)+hex.slice(2,4)+hex.slice(0,2)));}
 assert(kml.includes('2.5,2.5,0'));
 assert(!kml.includes('3,3,0 8,8,0'));
 assert.equal((c.journeyKml(data,'1',data.legs.map(c.journeyColour)).match(/<Placemark>/g)||[]).length,1);
});
test('6512 条轨道单步增删仅改一层，截断和换色更新原层，重复 way 独立保留',()=>{
 const counts={add:0,remove:0,geometry:0,style:0};
 const c=vm.createContext({TRACK_STYLES:{journey:{weight:3,opacity:1}},L:{polyline:()=>({
  addTo(){counts.add++;return this},setLatLngs(){counts.geometry++},setStyle(){counts.style++}})}});
 vm.runInContext(fs.readFileSync(__dirname+'/../app/static/journey_layers.js','utf8'),c);
 const renderer=c.createJourneyLayers({removeLayer(){counts.remove++}});
 const tracks=Array.from({length:6512},(_,i)=>({id:i,leg:0,coords:[[i,0],[i+1,0]],color:'#123456'}));
 renderer.update(tracks);assert.equal(counts.add,6512);
 renderer.update(structuredClone(tracks));assert.deepEqual(counts,{add:6512,remove:0,geometry:0,style:0});
 const extra={...tracks.at(-1),coords:[[6512,0],[6513,0]]};
 renderer.update([...tracks,extra]);assert.equal(counts.add,6513);
 renderer.update(tracks);assert.equal(counts.remove,1);
 const cut=structuredClone(tracks);cut.at(-1).coords[1]=[6511.5,0];cut.at(-1).color='#654321';
 renderer.update(cut);assert.equal(counts.geometry,1);assert.equal(counts.style,1);assert.equal(counts.add,6513);
 renderer.update([]);assert.equal(counts.remove,6513);
});
