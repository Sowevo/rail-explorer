const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initInstantTooltips}=require('../app/static/instant_tooltips.js');
test('静态与动态控件即时提示；第三方原生提示迁移，离开与移除清理',()=>{
 const events={},instances=[];let observer;
 class El{
  constructor(){this.nodeType=1;this.dataset={};this.attrs={};this.children=[];this.isConnected=true;}
  closest(selector){return selector==='[data-tooltip]'&&this.dataset.tooltip?this:null;}
  contains(el){return el===this||this.children.includes(el);}
  querySelectorAll(){return this.children.filter(el=>el.hasAttribute('title'));}
  hasAttribute(k){return k in this.attrs;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}
 }
 const doc={body:new El(),documentElement:new El(),addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 const native=new El();native.attrs.title='放大地图';doc.documentElement.children.push(native);
 global.document=doc;global.MutationObserver=class{constructor(callback){observer=callback}observe(){}disconnect(){}};
 global.bootstrap={Tooltip:class{
  constructor(el,options){this.el=el;this.options=options;instances.push(this)}
  show(){this.shown=true}dispose(){this.disposed=true}
 }};
 const controls=initInstantTooltips(doc);
 assert.equal(native.hasAttribute('title'),false);assert.equal(native.dataset.tooltip,'放大地图');
 events.pointerover({target:native});assert.equal(instances[0].options.delay,0);assert.equal(instances[0].options.animation,false);assert.equal(instances[0].options.title(),'放大地图');
 events.pointerout({target:native,relatedTarget:null});assert.equal(instances[0].disposed,true);
 const dynamic=new El();dynamic.dataset.tooltip='前进';let reason='先确定方向';dynamic.tooltipText=()=>reason;
 events.focusin({target:dynamic});assert.equal(instances.at(-1).options.title(),reason);
 reason='关系内有分支';assert.equal(instances.at(-1).options.title(),reason);
 dynamic.isConnected=false;observer([]);assert.equal(instances.at(-1).disposed,true);
 events.pointerover({target:native});events.click({});assert.equal(instances.at(-1).disposed,true);
 const later=new El();later.attrs.title='第三方控件';observer([{type:'childList',addedNodes:[later]}]);assert.equal(later.hasAttribute('title'),false);assert.equal(later.dataset.tooltip,'第三方控件');
 controls.dispose();assert.deepEqual(events,{});
});
test('页面和业务脚本禁止设置原生 title 悬浮属性',()=>{
 const files=['app/templates/index.html',...fs.readdirSync('app/static').filter(f=>f.endsWith('.js')).map(f=>'app/static/'+f)];
 for(const file of files){const s=fs.readFileSync(__dirname+'/../'+file,'utf8');
  assert.doesNotMatch(s,/<[a-z][^<>]*\stitle\s*=/i,file);
  assert.doesNotMatch(s,/\.title\s*=/,file);
  assert.doesNotMatch(s,/setAttribute\(\s*['"]title['"]/,file);
 }
});
