// 全页统一的即时提示：动态元素按需创建，离开、点击或移除时立即清理。
function initInstantTooltips(root = document) {
  let active = null, tooltip = null;
  const listeners = [];
  function listen(name, fn, capture = false) {
    root.addEventListener(name, fn, capture);
    listeners.push([name,fn,capture]);
  }
  const text = element => typeof element.tooltipText === 'function'
    ? element.tooltipText() : element.dataset.tooltip;
  function hide() {
    tooltip?.dispose();
    tooltip = active = null;
  }
  function show(element) {
    if (!element || !text(element)) { hide(); return; }
    if (active === element) return;
    hide();
    active = element;
    tooltip = new bootstrap.Tooltip(element, {
      title:() => text(element), container:element.closest('dialog') || document.body,
      trigger:'manual', delay:0, animation:false, html:false
    });
    tooltip.show();
  }
  const target = event => event.target.closest?.('[data-tooltip]');
  listen('pointerover', event => show(target(event)));
  listen('focusin', event => show(target(event)));
  for (const name of ['pointerout', 'focusout']) listen(name, event => {
    if (active?.contains(event.target) && !active.contains(event.relatedTarget)) hide();
  });
  listen('click', hide, true);
  listen('keydown', event => { if (event.key === 'Escape') hide(); });
  listen('scroll', hide, true);
  // 地图库等第三方控件生成的原生提示也转为即时提示。
  function migrate(element) {
    if (element.nodeType !== 1) return;
    for (const item of [element,...element.querySelectorAll('[title]')]) {
      if (!item.hasAttribute('title')) continue;
      if (!item.dataset.tooltip) item.dataset.tooltip = item.getAttribute('title');
      item.removeAttribute('title');
    }
  }
  migrate(root.documentElement || root);
  const observer = new MutationObserver(records => {
    if (active && !active.isConnected) hide();
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.attributeName === 'title') migrate(record.target);
        if (record.target === active) hide();
      } else record.addedNodes.forEach(migrate);
    }
  });
  observer.observe(root.documentElement || root, {subtree:true,childList:true,
    attributes:true,attributeFilter:['title','data-tooltip','disabled']});
  return {dispose() {
    hide(); observer.disconnect();
    listeners.forEach(args => root.removeEventListener(...args));
  }};
}
if (typeof module !== 'undefined') module.exports = {initInstantTooltips};
