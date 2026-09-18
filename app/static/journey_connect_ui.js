// 连接预览沿用地图轨道样式与原有操作入口，确认之前不修改行程。
function initJourneyConnect(map,options) {
  let controller=null,control=null,layer=null,plan=null;
  function cancel() {
    controller?.abort();controller=null;plan=null;
    if(control)map.removeControl(control);control=null;
    if(layer)map.removeLayer(layer);layer=null;
    options.arrows.clear('connection');
  }
  function open(wayId) {
    cancel();
    return options.runAction(async()=>{
      options.clearPreview();
      controller=new AbortController();
      const request=controller;
      const card=document.createElement('div');
      card.className='bg-white border rounded shadow p-2';
      card.style.maxWidth='320px';
      const heading=document.createElement('div');heading.className='fw-bold mb-1';heading.textContent='连接到此轨道';
      const status=document.createElement('div');status.className='small mb-2';status.setAttribute('role','status');status.textContent='正在查找连接路径…';
      const actions=document.createElement('div');actions.className='d-flex gap-2';
      const confirm=document.createElement('button');confirm.type='button';confirm.className='btn btn-primary btn-sm';confirm.disabled=true;
      confirm.innerHTML='<i class="bi bi-link-45deg me-1" aria-hidden="true"></i>确认连接';
      const close=document.createElement('button');close.type='button';close.className='btn btn-outline-secondary btn-sm';
      close.innerHTML='<i class="bi bi-x-lg me-1" aria-hidden="true"></i>取消';close.onclick=cancel;
      actions.append(confirm,close);card.append(heading,status,actions);
      L.DomEvent.disableClickPropagation(card);L.DomEvent.disableScrollPropagation(card);
      control=L.control({position:'bottomleft'});control.onAdd=()=>card;control.addTo(map);
      try {
        const result=await options.api.connectPreview({way_id:wayId},{signal:request.signal});
        if(request.signal.aborted)return;
        plan=result;
        const recommendation=result.recommendation;
        const markers=recommendation ? [
          L.polyline(recommendation.original_track.coords,TRACK_STYLES.candidate)
            .bindTooltip(`原选轨道 ${wayId}`,{sticky:true}),
          L.circleMarker(recommendation.original_point,{radius:5,color:TRACK_STYLES.candidate.color,fillOpacity:1})
            .bindTooltip('原选位置',{permanent:true,direction:'top'}),
          L.circleMarker(recommendation.point,{radius:6,color:TRACK_STYLES.preview.color,fillOpacity:1})
            .bindTooltip('推荐汇入点',{permanent:true,direction:'top'})
        ] : [];
        layer=L.featureGroup([
          ...markers,
          ...result.removed_tracks.map(track=>L.polyline(track.coords,TRACK_STYLES.highlight)),
          ...result.tracks.map(track=>L.polyline(track.coords,TRACK_STYLES.preview))
        ]).addTo(map);
        options.arrows.showTracks('connection',result.tracks,TRACK_STYLES.preview);
        status.textContent=`${result.rollback ? `退回 ${result.rollback} 条轨道，` : '保留已有轨迹，'}新增 ${(result.distance_m/1000).toFixed(2)} 公里。橙色为连接路径${result.rollback?'，红色部分将移除':''}。确认后继续当前段。`;
        if(recommendation) {
          heading.textContent='推荐同线汇入点';
          status.textContent=`未找到顺向接到原选位置的路径。可在同线${recommendation.direction}侧、沿线约 ${(recommendation.offset_m/1000).toFixed(2)} 公里处汇入。` + status.textContent;
          confirm.innerHTML='<i class="bi bi-link-45deg me-1" aria-hidden="true"></i>改接推荐位置';
        }
        confirm.disabled=false;
        if(layer.getBounds().isValid())map.fitBounds(layer.getBounds(),{padding:[40,40],maxZoom:17});
        confirm.onclick=()=>options.runAction(async()=>{
          confirm.disabled=true;
          try {
            const data=await options.api.connect({way_id:wayId,revision:plan.revision,accept_recommendation:Boolean(plan.recommendation)});
            cancel();options.onChanged(data);
          } catch(error){cancel();throw error;}
        },{keepConnect:true});
      } catch(error) {
        const aborted=request.signal.aborted;
        cancel();
        if(!aborted)throw error;
      }
    },{keepConnect:true});
  }
  return {open,cancel};
}
if(typeof module!=='undefined')module.exports={initJourneyConnect};
