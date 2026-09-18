const {test} = require('node:test'), assert = require('node:assert/strict');
global.JourneyEngine = require('../app/static/journey_engine.js').JourneyEngine;
const {createJourneyApi,startRestriction} = require('../app/static/journey_api.js');
const ways={1:[1,2],2:[2,3],3:[3,4],9:[9,10]};
let version='china',requests=[],failId=null,waitTrack=null,recommendConnection=false,waitConnection=null;
global.JourneyConnector=require('../app/static/journey_connect.js').JourneyConnector;
global.fetch=async(url,options={})=>{
  const body=options.body ? JSON.parse(options.body) : {};
  requests.push({url,body,options});
  if(url==='/diagnostics')return {ok:true,json:async()=>({ok:true})};
  if(url.startsWith('/dataset'))return {ok:true,json:async()=>({dataset_version:version})};
  if(url.startsWith('/elements/relation/')) {
    if(new URL(url,'http://localhost').searchParams.get('dataset_version')!==version)
      return {ok:false,json:async()=>({code:'dataset_changed',dataset_version:version})};
    return {ok:true,json:async()=>({ways:[{id:1},{id:2},{id:3}]})};
  }
  if(body.dataset_version!==version)return {ok:false,json:async()=>({code:'dataset_changed',dataset_version:version})};
  if(url==='/connections/preview') {
    if(waitConnection)await waitConnection;
    return {ok:true,json:async()=>({dataset_version:version,target_way:body.target_way,connected_way:3,
      rollback:0,retained_span:body.tail.at(-1).span,items:[{way_id:3,span:[0,1]}],tracks:[],removed_tracks:[],
      ...(recommendConnection?{recommendation:{way_id:3}}:{}),
      track_data:{ways:{3:{nodes:ways[3],meta:{tags:{name:'测试'}}}},coords:{3:[35,139.003],4:[35,139.004]},
        node_ways:{3:[2,3],4:[3]},stops:[]}})};
  }
  if(waitTrack)await waitTrack;
  if(body.way_ids.includes(failId))throw new Error('模拟网络失败');
  const nodes=[...new Set(body.way_ids.flatMap(id=>ways[id]))];
  return {ok:true,json:async()=>({dataset_version:version,
    ways:Object.fromEntries(body.way_ids.map(id=>[id,{nodes:ways[id],meta:{tags:{name:'测试'}}}])),
    coords:Object.fromEntries(nodes.map(n=>[n,[35,139+n*.001]])),
    node_ways:Object.fromEntries(nodes.map(n=>[n,Object.entries(ways).filter(([id,ns])=>ns.includes(n)).map(([id])=>+id)])),
    stops:[]})};
};
function page(){
  let data=null,message='';
  const api=createJourneyApi({getData:()=>data,datasetVersion:version,onDatasetChanged:m=>message=m});
  return {api,get data(){return data},set data(d){data=d},get message(){return message}};
}
test('数据按需加载复用；请求不含行程、坐标或Cookie；两页面独立',async()=>{
  requests=[];const p=page(),q=page();
  p.data=await p.api.advance({way_id:1});
  assert.equal(p.data.legs[0].path.length,1);assert.equal(q.data,null);
  const reads=requests.filter(r=>r.url==='/track-data').length;
  await p.api.startPreview({way_id:1,point:[35,139.0015],replace_current:true});
  assert.equal(requests.filter(r=>r.url==='/track-data').length,reads);
  p.data=await p.api.advance({way_id:2});
  assert.equal(p.data.legs[0].path.length,3);
  for(const request of requests){
    assert.equal(request.options.credentials,'omit');
    assert.ok(!('legs' in request.body));
    assert.ok(!('path' in request.body));
    assert.ok(!('coords' in request.body));
    assert.ok(!request.url.startsWith('/journey'));
  }
  assert.equal(page().data,null,'新页面没有恢复');
  assert.match(startRestriction(p.data,null),/首条/);
  assert.equal(startRestriction(p.data,9),'');
});
test('后端切换：内存已有数据的操作也拒绝；原行程保留供导出；清空重新绑定',async()=>{
  const p=page();p.data=await p.api.advance({way_id:1});const before=p.data;
  version='japan';
  await assert.rejects(p.api.undo(),/数据源已切换/);
  assert.equal(p.data,before);assert.ok(p.data.total_path_coords.length);
  assert.equal(p.api.blocked,true);assert.match(p.message,/导出/);
  p.data=await p.api.clear();
  assert.equal(p.data.legs.length,0);
  p.data=await p.api.advance({way_id:9});
  assert.equal(p.data.dataset_version,'japan');
  assert.equal(p.api.blocked,false);
});
test('失败的自动推进草稿不覆盖已显示行程',async()=>{
  const p=page();p.data=await p.api.advance({way_id:1});const before=p.data;
  failId=3;
  await assert.rejects(p.api.advance({way_id:2}),/模拟网络失败/);
  assert.equal(p.data,before);assert.equal(p.data.legs[0].path.length,1);
  failId=null;
});
test('重复修改拒绝；预览和版本过期结果丢弃',async()=>{
  const p=page();
  let release;waitTrack=new Promise(resolve=>release=resolve);
  const pending=p.api.advance({way_id:1});
  await assert.rejects(p.api.advance({way_id:1}),/上一项操作/);
  release();waitTrack=null;p.data=await pending;
  await assert.rejects(p.api.start({way_id:1,revision:-1,point:[35,139.0015],direction:1}),/行程已变化/);
  // 当前预览在加载另一条way时清空；晚返回不能改变数据版本或提交结果。
  let resume;waitTrack=new Promise(resolve=>resume=resolve);
  const preview=p.api.startPreview({way_id:9,point:[35,139.0095]});
  await new Promise(resolve=>setImmediate(resolve));
  p.data=await p.api.clear();
  resume();waitTrack=null;
  await assert.rejects(preview,/过期/);
  assert.equal(p.data.legs.length,0);assert.equal(p.api.blocked,false);
});

test('关系预览不修改行程；整组加入复查版本与修订号，不传整段行程',async()=>{
 requests=[];const p=page();
 p.data=await p.api.advance({way_id:1});
 const endpointPlan=await p.api.relationPreview({relation_id:10,anchor_way:1});
 assert.deepEqual(endpointPlan.items.map(item=>item.way_id),[2,3]);
 p.data=await p.api.forward({way_id:2});
 const before=p.data;
 const plan=await p.api.relationPreview({relation_id:10,anchor_way:1});
 assert.equal(p.data,before);assert.equal(plan.revision,before.revision);
 assert.deepEqual(plan.items.map(item=>item.way_id),[3]);
 await assert.rejects(p.api.advanceRelation({relation_id:10,anchor_way:1,revision:plan.revision-1}),/行程已变化/);
 p.data=await p.api.advanceRelation({relation_id:10,anchor_way:1,revision:plan.revision});
 assert.equal(p.data.current_way,3);assert.equal(p.data.legs.length,1);
 assert.equal(p.data.revision,plan.revision+1);
 for(const r of requests){assert.ok(!('legs' in r.body));assert.ok(!('path' in r.body));}
 const q=page();q.data=await q.api.advance({way_id:1});q.data=await q.api.forward({way_id:2});
 const old=q.data;version+='-changed';
 await assert.rejects(q.api.advanceRelation({relation_id:10,anchor_way:1,revision:old.revision}),/数据源已切换/);
 assert.equal(q.data,old);
});

test('连接预览不修改行程；确认使用同一预览，过期和切换数据源均拒绝',async()=>{
 global.JourneyConnector=require('../app/static/journey_connect.js').JourneyConnector;
 const p=page();p.data=await p.api.advance({way_id:1});p.data=await p.api.forward({way_id:2});
 const before=p.data;
 const plan=await p.api.connectPreview({way_id:3});
 assert.equal(p.data,before);assert.equal(plan.revision,before.revision);
 assert.deepEqual(plan.items.map(x=>x.way_id),[3]);
 p.data=await p.api.connect({way_id:3,revision:plan.revision});
 assert.equal(p.data.current_way,3);assert.equal(p.data.legs.length,1);
 await assert.rejects(p.api.connect({way_id:3,revision:plan.revision}),/行程已变化/);
 const q=page();q.data=await q.api.advance({way_id:1});q.data=await q.api.forward({way_id:2});
 const stale=await q.api.connectPreview({way_id:3});q.data=await q.api.undo();
 await assert.rejects(q.api.connect({way_id:3,revision:stale.revision}),/行程已变化/);
 q.data=await q.api.forward({way_id:2});await q.api.connectPreview({way_id:3});
 const old=version;version='changed-for-connect';
 try {await assert.rejects(q.api.connect({way_id:3}),/数据源已切换/);} finally {version=old;}
 assert.equal(q.data.current_way,2);
 assert.ok(requests.filter(r=>r.url==='/track-data').every(r=>!r.body.legs&&!r.body.path));
});

test('推荐方案必须明确接受，不能用普通确认静默替换目标',async()=>{
 recommendConnection=true;
 try {
  const p=page();p.data=await p.api.advance({way_id:1});p.data=await p.api.forward({way_id:2});
  const plan=await p.api.connectPreview({way_id:3}),before=p.data;
  await assert.rejects(p.api.connect({way_id:3,revision:plan.revision}),/确认改接/);assert.equal(p.data,before);
  p.data=await p.api.connect({way_id:3,revision:plan.revision,accept_recommendation:true});
  assert.equal(p.data.current_way,3);assert.match(p.data.stop_reason,/推荐/);
 } finally {recommendConnection=false;}
});

test('一次连接查找仅一个业务请求，确认不补取track-data；取消或旧结果不应用',async()=>{
 const p=page();p.data=await p.api.advance({way_id:1});p.data=await p.api.forward({way_id:2});
 requests=[];const plan=await p.api.connectPreview({way_id:3});
 assert.deepEqual(requests.filter(r=>r.url!=='/diagnostics').map(r=>r.url),['/connections/preview']);
 const body=requests.find(r=>r.url==='/connections/preview').body;
 assert.equal(body.tail.length,2);assert.ok(!body.legs&&!body.coords&&!body.path);
 p.data=await p.api.connect({way_id:3,revision:plan.revision});
 assert.ok(!requests.some(r=>r.url==='/track-data'));
 const q=page();q.data=await q.api.advance({way_id:1});q.data=await q.api.forward({way_id:2});
 let release;waitConnection=new Promise(resolve=>release=resolve);
 const controller=new AbortController(),before=q.data,pending=q.api.connectPreview({way_id:3},{signal:controller.signal});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();release();
 try {await assert.rejects(pending,/过期/);assert.equal(q.data,before);await assert.rejects(q.api.connect({way_id:3}),/失效/);}
 finally {waitConnection=null;}
});
