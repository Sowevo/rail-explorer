// 前端仅整理寻路约束、应用已确认方案；图搜索统一在后端执行。
class JourneyConnector {
  constructor(engine) { this.engine = engine; }
  request(legs,target) {
    const e=this.engine,leg=legs.at(-1);
    if(!leg?.path.length)throw new Error('请先开始一段行程。');
    if(!Number.isSafeInteger(target))throw new Error('请选择有效的目标轨道。');
    if(leg.path.some(item=>item.way_id===target))throw new Error('目标轨道已在当前行程中，请选择尚未加入的轨道。');
    const start=Math.max(0,leg.path.length-11);
    const tail=leg.path.slice(start).map((item,index)=>{
      const directions=e.directions(leg.path,start+index);
      return {way_id:item.way_id,span:directions.length===1?[...directions[0]]:null};
    });
    if(!tail.at(-1).span)throw new Error('请先选择下一条轨道或指定起点，确认行进方向。');
    return {target_way:target,tail,
      blocked_nodes:[...new Set(leg.path.slice(0,start).flatMap(item=>e.keptNodes(item)))],
      used_way_ids:[...new Set(leg.path.map(item=>item.way_id))]};
  }
  async apply(legs,plan) {
    const e=this.engine,updated=structuredClone(legs),leg=updated.at(-1);
    if(!leg || !Number.isInteger(plan.rollback) || plan.rollback<0 || plan.rollback>10 || plan.rollback>=leg.path.length)
      throw new Error('连接方案的回退范围无效，请重新查找。');
    leg.path=leg.path.slice(0,leg.path.length-plan.rollback);
    leg.path.at(-1).span=[...plan.retained_span];
    leg.path.push(...plan.items.map(item=>({...item,span:[...item.span],type:'manual'})));
    leg.current_way=leg.path.at(-1).way_id;
    return e.response(updated,{...await e.choices(leg),path:plan.items.map(item=>item.way_id),
      stop_reason:plan.recommendation ? '已连接到确认的推荐位置，继续当前行程。' : '已连接到目标轨道，继续当前行程。'});
  }
}
if(typeof module!=='undefined')module.exports={JourneyConnector};
