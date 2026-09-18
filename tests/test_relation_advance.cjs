const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JourneyEngine}=require('../app/static/journey_engine.js');
function setup(ways){
 const store={ways:new Map(),coords:new Map(),nodeWays:new Map(),stops:new Set(),async ensure(ids){for(const id of ids)assert.ok(this.ways.has(id),'missing '+id)}};
 for(const [id,nodes] of Object.entries(ways)){
  store.ways.set(+id,{nodes,meta:{tags:{name:'测试'}}});
  for(const n of nodes){store.coords.set(n,[35,139+n*.001]);store.nodeWays.set(n,[...(store.nodeWays.get(n)||[]),+id]);}
 }
 return new JourneyEngine(store);
}
const base={1:[1,2],2:[2,3],3:[3,4],4:[4,5],5:[5,6],8:[3,8]};
const legs=(...ids)=>[{name:'测试',start_way:ids[0],current_way:ids.at(-1),path:ids.map(way_id=>({way_id,type:'manual'}))}];
test('关系外分支不阻止；按连接顺序加入前方部分，到关系末端停',async()=>{
 const e=setup(base),before=legs(1,2),copy=structuredClone(before);
 const plan=await e.relationPreview(before,[4,2,1,3]);
 assert.deepEqual(plan.items.map(x=>x.way_id),[3,4]);
 assert.deepEqual(plan.items.map(x=>x.span),[[0,1],[0,1]]);
 const result=await e.advanceRelation(before,[4,2,1,3]);
 assert.deepEqual(result.legs[0].path.map(x=>x.way_id),[1,2,3,4]);
 assert.equal(result.legs.length,1);assert.ok(result.choices.includes(5));
 assert.deepEqual(before,copy);
 const undone=await e.undo(result.legs);assert.deepEqual(undone.legs[0].path.map(x=>x.way_id),[1,2,3]);
});
test('反向行驶只加入反向前方，不重复身后的轨道',async()=>{
 const e=setup(base),plan=await e.relationPreview(legs(4,3),[1,2,3,4]);
 assert.deepEqual(plan.items.map(x=>x.way_id),[2,1]);
 assert.ok(plan.tracks.every(x=>x.reversed));
});
test('眼前有分支或接入内点时拒绝；远处缺口不阻止前方连续部分',async()=>{
 await assert.rejects(setup(base).relationPreview(legs(2),[1,2,3]),/方向/);
 await assert.rejects(setup(base).relationPreview(legs(1,2),[1,2,3,8]),/多个连接/);
 await assert.rejects(setup({...base,9:[9,3,10]}).relationPreview(legs(1,2),[1,2,9]),/中间/);
 const plan=await setup({...base,9:[9,10]}).relationPreview(legs(1,2),[1,2,3,9]);
 assert.deepEqual(plan.items.map(x=>x.way_id),[3]);
 assert.match(plan.stop_reason,/相连部分的末端/);
});
test('远处分支先走到分岔端点，候选可手动选，再继续关系',async()=>{
 const e=setup({...base,9:[5,9],10:[9,10]});
 const ids=[1,2,3,4,5,9,10];
 const result=await e.advanceRelation(legs(1,2),ids);
 assert.deepEqual(result.legs[0].path.map(x=>x.way_id),[1,2,3,4]);
 assert.match(result.stop_reason,/多个连接/);
 assert.ok(result.choices.includes(5));assert.ok(result.choices.includes(9));
 const selected=await e.advance(result.legs,{way_id:9},true);
 assert.deepEqual((await e.relationPreview(selected.legs,ids)).items.map(x=>x.way_id),[10]);
});
test('中途共点停在问题way之前；不把上下行连通组全部拒绝',async()=>{
 const e=setup({...base,4:[4,40,5],9:[90,40,91]});
 const result=await e.advanceRelation(legs(1,2),[1,2,3,4,5,9]);
 assert.deepEqual(result.legs[0].path.map(x=>x.way_id),[1,2,3]);
 assert.match(result.stop_reason,/中途.*之前/);assert.ok(result.choices.includes(4));
 await assert.rejects(e.relationPreview(result.legs,[1,2,3,4,5,9]),/中途/);
});
test('反向推进也停在前方中途分支之前；身后分支不干扰',async()=>{
 const e=setup({...base,2:[2,20,3],9:[90,20,91]});
 const plan=await e.relationPreview(legs(5,4),[1,2,3,4,5,9]);
 assert.deepEqual(plan.items.map(x=>x.way_id),[3]);assert.match(plan.stop_reason,/中途/);
 const forward=await e.relationPreview(legs(2,3),[1,2,3,4,5,9]);
 assert.deepEqual(forward.items.map(x=>x.way_id),[4,5]);
});
test('闭环和回到已选轨道之前停止，前面确定的部分仍可加入',async()=>{
 const e=setup({...base,9:[4,1]});
 const plan=await e.relationPreview(legs(1,2),[1,2,3,9]);
 assert.deepEqual(plan.items.map(x=>x.way_id),[3]);assert.match(plan.stop_reason,/闭环|已选/);
 await assert.rejects(setup({...base,9:[3,9,3]}).relationPreview(legs(1,2),[1,2,9]),/多个连接|闭环/);
});
test('已知起点与部分末条：只补上剩余区间，退回仍只缩短',async()=>{
 const e=setup({...base,1:[1,7,2]});
 const current=legs(1);current[0].path[0].span=[.5,1.5];
 const plan=await e.relationPreview(current,[1,2,3]);
 assert.deepEqual(plan.items[0],{way_id:1,span:[1.5,2]});
 const result=await e.advanceRelation(current,[1,2,3]);
 assert.deepEqual(result.legs[0].path[0].span,[.5,1.5]);
 assert.deepEqual(result.legs[0].path[1].span,[1.5,2]);
 assert.equal(result.current_way,3);
});
test('不在关系内时可从前进端接链头，不能跳过缺口或从中间接入',async()=>{
 const e=setup(base);
 assert.deepEqual((await e.relationPreview(legs(1,2),[3,4])).items.map(x=>x.way_id),[3,4]);
 await assert.rejects(e.relationPreview(legs(1,2),[4,5]),/前进端/);
 await assert.rejects(e.relationPreview(legs(1,2),[3,8]),/多个连接/);
});
test('到末端、折返或接回旧轨迹时拒绝，原行程保持不变',async()=>{
 const e=setup({...base,9:[4,1]});
 await assert.rejects(e.relationPreview(legs(1,2,3),[1,2,3]),/末端/);
 await assert.rejects(e.relationPreview(legs(1,2),[1]),/前进端/);
 assert.deepEqual((await e.relationPreview(legs(1,2),[3,9])).items.map(x=>x.way_id),[3]);
 const old=legs(4,1,2),copy=structuredClone(old);
 await assert.rejects(e.advanceRelation(old,[2,3,4]),/已选/);assert.deepEqual(old,copy);
});

test('首条位于连续链任一端时推断向内方向，不依赖成员顺序',async()=>{
 const e=setup(base);
 for(const [first,expected,span] of [[1,[2,3,4],[0,1]],[4,[3,2,1],[1,0]]]){
  const before=legs(first),copy=structuredClone(before);
  const plan=await e.relationPreview(before,[3,1,4,2]);
  assert.deepEqual(plan.items.map(x=>x.way_id),expected);assert.deepEqual(plan.inferred_span,span);
  assert.deepEqual(before,copy,'预览不改行程');
  const result=await e.advanceRelation(before,[3,1,4,2]);
  assert.deepEqual(result.legs[0].path.map(x=>x.way_id),[first,...expected]);
  assert.deepEqual(result.legs[0].path[0].span,span);
  assert.deepEqual(before,copy,'执行不直接修改旧行程');
 }
});
test('单条关系没有延伸方向；链外或多条轨道方向不明不能套用端头推断',async()=>{
 const e=setup(base);
 await assert.rejects(e.relationPreview(legs(1),[1]),/方向/);
 await assert.rejects(e.relationPreview(legs(1),[2,3]),/方向/);
 await assert.rejects(e.relationPreview(legs(8,1),[1,2,3]),/方向/);
});
