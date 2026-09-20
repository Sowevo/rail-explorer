// 已选轨道按行程顺序复用图层；同一 way 的不同保留部分也各有独立图层。
function createJourneyLayers(map) {
  const entries = [];
  const sameCoords = (a, b) => a.length === b.length &&
    a.every((point, i) => point[0] === b[i][0] && point[1] === b[i][1]);
  return {
    update(tracks) {
      const visible = tracks.filter(track => track.coords?.length >= 2);
      while (entries.length > visible.length) map.removeLayer(entries.pop().layer);
      visible.forEach((track, index) => {
        let entry = entries[index];
        if (!entry) {
          entry = {layer:L.polyline(track.coords, {...TRACK_STYLES.journey, color:track.color}).addTo(map)};
          entries.push(entry);
        } else {
          if (!sameCoords(entry.coords, track.coords)) entry.layer.setLatLngs(track.coords);
          if (entry.color !== track.color) entry.layer.setStyle({color:track.color});
        }
        entry.coords = track.coords;
        entry.color = track.color;
      });
    }
  };
}
