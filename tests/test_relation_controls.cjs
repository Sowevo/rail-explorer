const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../app/templates/index.html','utf8');
function setup(){
 const buttons=[],drawn=[],mutations=[],status={classList:{remove(){},add(){}},textContent:''};
 class Element{
  constructor(){this.children=[];this.dataset={};this.isConnected=true;this.attributes={};}
  appendChild(child){this.children.push(child);if(child.dataset.relationAdvance)buttons.push(child);}
  setAttribute(k,v){this.attributes[k]=v;}
 }
 const context={lastData:{revision:4,legs:[{path:[{}]}]},trackActionPending:false,relationHoverOwner:null,
  cutControl:null,startControl:null,updateUndoButton(){},bootstrap:{Tooltip:class{constructor(el,options){el.tooltip=options}}},
  document:{createElement:()=>new Element(),getElementById:()=>status,
   querySelector:q=>buttons.find(b=>String(b.dataset.relationAdvance)===q.match(/="(\d+)"/)[1]),querySelectorAll:()=>buttons},
  journeyApi:{relationPreview:async()=>({tracks:[{id:3,coords:[[1,2],[3,4]]}],revision:4}),
   advanceRelation:async payload=>(mutations.push(payload),{revision:5,legs:[{}]})},
  drawNearbyTracks:t=>drawn.push(t),drawElementPreview:d=>drawn.push(d),clearPreview(){context.relationHoverOwner=null},
  clearNearbyQuery(){},clearElementDetail(){},renderWays:d=>{context.lastData=d}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    async function runTrackAction('),source.indexOf('    const typeNames')),context);
 vm.runInContext(source.slice(source.indexOf('    async function prepareRelationAdvance('),source.indexOf('    function elementTitle(')),context);
 return {context,buttons,drawn,mutations,status};
}
test('关系按钮先验证；悬浮只预览新增部分，离开恢复；点击沿用行程操作入口',async()=>{
 const {context:c,drawn,mutations}=setup(),data={id:10};
 const wrapper=c.relationAdvanceButton(data,1),button=wrapper.children[0];
 assert.equal(button.disabled,true);assert.match(wrapper.tooltipText(),/先点击关系/);
 await c.runTrackAction(()=>c.prepareRelationAdvance(data,1));
 assert.equal(button.disabled,false);assert.match(wrapper.tooltipText(),/遇到分支停下/);
 wrapper.onmouseenter();assert.equal(drawn.at(-1)[0].id,3);
 wrapper.onmouseleave();assert.equal(drawn.at(-1),data);
 await button.onclick();assert.equal(mutations.length,1);
 assert.equal(mutations[0].relation_id,10);assert.equal(mutations[0].revision,4);assert.equal(mutations[0].anchor_way,1);
});
test('禁用原因不会被统一解锁覆盖；换选关系和过期结果不会误启用',async()=>{
 const {context:c}=setup();
 const a=c.relationAdvanceButton({id:10},1).children[0],b=c.relationAdvanceButton({id:20},1).children[0];
 await c.runTrackAction(()=>c.prepareRelationAdvance({id:10},1));assert.equal(a.disabled,false);
 c.journeyApi.relationPreview=async()=>{throw new Error('关系内存在分支')};
 await c.runTrackAction(()=>c.prepareRelationAdvance({id:20},1));
 assert.equal(a.disabled,true);assert.equal(b.disabled,true);assert.equal(b.dataset.disabledReason,'关系内存在分支');
 let resolve;c.journeyApi.relationPreview=()=>new Promise(r=>resolve=r);
 const pending=c.prepareRelationAdvance({id:20},1);c.lastData={revision:5};resolve({tracks:[]});await pending;
 assert.equal(b.disabled,true);assert.equal(b.relationPreview,null);
});
