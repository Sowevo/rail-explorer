const {test}=require('node:test'),assert=require('node:assert/strict');
const {JourneyEngine}=require('../app/static/journey_engine.js');
const {JourneyConnector}=require('../app/static/journey_connect.js');
function setup(count=15){
 const store={ways:new Map(),coords:new Map(),nodeWays:new Map(),stops:new Set(),async ensure(){}};
 for(let id=1;id<=count;id++){
  store.ways.set(id,{nodes:[id,id+1],meta:{tags:{name:'测试'}}});
  for(const n of [id,id+1]){store.coords.set(n,[35,139+n*.001]);store.nodeWays.set(n,[...(store.nodeWays.get(n)||[]),id]);}
 }
 return new JourneyConnector(new JourneyEngine(store));
}
const legs=(count)=>[{name:'测试',start_way:1,current_way:count,path:Array.from({length:count},(_,i)=>({way_id:i+1,type:'manual'}))}];
test('请求只发末尾11条范围及前缀节点约束，不传坐标和整个行程',()=>{
 const c=setup(),before=legs(13),copy=structuredClone(before),data=c.request(before,15);
 assert.equal(data.tail.length,11);assert.equal(data.tail[0].way_id,3);assert.equal(data.tail.at(-1).way_id,13);
 assert.deepEqual(data.blocked_nodes,[1,2,3]);assert.equal(data.used_way_ids.length,13);
 assert.deepEqual(Object.keys(data).sort(),['blocked_nodes','tail','target_way','used_way_ids']);
 assert.deepEqual(data.tail[0].span,[0,1]);assert.deepEqual(before,copy);
});
test('精确保留部分轨道；未确定方向和已选目标拒绝',()=>{
 const c=setup(),before=legs(1);assert.throws(()=>c.request(before,3),/方向/);
 before[0].path[0].span=[.2,.7];assert.deepEqual(c.request(before,3).tail[0].span,[.2,.7]);
 assert.throws(()=>c.request(before,1),/已在/);
});
test('确认才应用后端方案，只改当前段，回退后恢复首尾连续范围',async()=>{
 const c=setup(),before=legs(4),copy=structuredClone(before);
 const plan={rollback:2,retained_span:[0,1],items:[{way_id:3,span:[0,.5]}],recommendation:{way_id:3}};
 const result=await c.apply(before,plan);
 assert.deepEqual(result.legs[0].path.map(x=>x.way_id),[1,2,3]);assert.deepEqual(result.legs[0].path.at(-1).span,[0,.5]);
 assert.equal(result.legs.length,1);assert.match(result.stop_reason,/推荐/);assert.deepEqual(before,copy);
 for(const rollback of [-1,11,4])await assert.rejects(c.apply(before,{...plan,rollback}),/回退范围/);
});
