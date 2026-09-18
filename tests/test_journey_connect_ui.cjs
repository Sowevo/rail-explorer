const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const controls=[],layers=[],calls=[],changed=[],arrows=[];
 class Element {constructor(){this.children=[];this.style={};this.dataset={};}append(...children){this.children.push(...children);}setAttribute(){}}
 const map={removeControl:c=>controls.splice(controls.indexOf(c),1),removeLayer:l=>layers.splice(layers.indexOf(l),1),fitBounds(){calls.push('fit')}};
 const plan={revision:7,rollback:1,distance_m:2345,tracks:[{coords:[[1,1],[2,2]]}],removed_tracks:[{coords:[[2,2],[3,3]]}]};
 const options={api:{async connectPreview(){return plan},async connect(p){calls.push(p);return {current_way:3}}},
  arrows:{clear(){},showTracks:(...x)=>arrows.push(x)},clearPreview(){},runAction:fn=>fn(),onChanged:d=>changed.push(d)};
 const ctx={AbortController,document:{createElement:()=>new Element()},TRACK_STYLES:{preview:{color:'orange'},highlight:{color:'red'},candidate:{color:'gray'}},
  L:{DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},
   control:()=>({addTo(){controls.push(this);this.card=this.onAdd();return this}}),
   circleMarker:(point,style)=>({point,style,bindTooltip(label){this.label=label;return this}}),
   polyline:(coords,style)=>({coords,style,bindTooltip(label){this.label=label;return this}}),featureGroup:lines=>({lines,addTo(){layers.push(this);return this},getBounds:()=>({isValid:()=>true})})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../app/static/journey_connect_ui.js','utf8'),ctx);
 return {ui:ctx.initJourneyConnect(map,options),options,controls,layers,calls,changed,arrows};
}
test('连接预览显示红色移除和橙色新增，确认带修订号且只有确认会改变行程',async()=>{
 const x=setup();await x.ui.open(3);
 assert.equal(x.changed.length,0);assert.equal(x.controls.length,1);
 const card=x.controls[0].card;
 assert.match(card.children[1].textContent,/退回 1.*2.35/);
 assert.deepEqual(Array.from(x.layers[0].lines,l=>l.style.color),['red','orange']);
 const [confirm]=card.children[2].children;assert.equal(confirm.disabled,false);await confirm.onclick();
 assert.equal(x.changed.length,1);assert.equal(x.calls.at(-1).revision,7);assert.equal(x.calls.at(-1).way_id,3);
 assert.equal(x.layers.length,0);assert.equal(x.controls.length,0);
});
test('取消预览或取消正在寻路时不修改行程，不遗留地图图层',async()=>{
 const x=setup();await x.ui.open(3);x.controls[0].card.children[2].children[1].onclick();
 assert.equal(x.changed.length,0);assert.equal(x.layers.length,0);
 let finish;x.options.api.connectPreview=()=>new Promise(resolve=>finish=resolve);
 const pending=x.ui.open(3);x.ui.cancel();finish({tracks:[]});await pending;
 assert.equal(x.changed.length,0);assert.equal(x.controls.length,0);assert.equal(x.layers.length,0);
});
test('寻路失败和确认失败向原状态栏报错，清理预览',async()=>{
 const x=setup();x.options.api.connectPreview=async()=>{throw new Error('没有连接')};
 await assert.rejects(x.ui.open(3),/没有连接/);assert.equal(x.controls.length,0);
 const y=setup();await y.ui.open(3);y.options.api.connect=async()=>{throw new Error('预览已失效')};
 await assert.rejects(y.controls[0].card.children[2].children[0].onclick(),/已失效/);
 assert.equal(y.changed.length,0);assert.equal(y.layers.length,0);
});

test('推荐预览同时标原目标与汇入点，明确按钮和确认参数',async()=>{
 const x=setup();x.options.api.connectPreview=async()=>({revision:7,rollback:0,distance_m:6000,
  tracks:[{coords:[[1,1],[2,2]]}],removed_tracks:[],recommendation:{way_id:12,point:[2,2],original_point:[1,2],
   original_track:{coords:[[1,2],[1.1,2]]},direction:'南',offset_m:4701}});
 await x.ui.open(10);const card=x.controls[0].card;
 assert.equal(card.children[0].textContent,'推荐同线汇入点');assert.match(card.children[1].textContent,/南侧.*4.70/);
 assert.ok(x.layers[0].lines.some(line=>line.label==='原选位置'));
 assert.ok(x.layers[0].lines.some(line=>line.label==='推荐汇入点'));
 const confirm=card.children[2].children[0];assert.match(confirm.innerHTML,/改接推荐位置/);await confirm.onclick();
 assert.equal(x.calls.at(-1).accept_recommendation,true);assert.equal(x.calls.at(-1).way_id,10);
});
