/* ONEXUS – Graph Logic
*/
(function () {
  /* ====== Constants & UI state ====== */
  const LABELS = {
    en: { Controls:"Controls", Supplies:"Supplies", LocatedIn:"Located In", DesignedBy:"Designed By", BuiltBy:"Built By", ProvidedBy:"Provided By", PartOfSystem:"Part Of System" },
    jp: { Controls:"制御", Supplies:"供給", LocatedIn:"設置場所", DesignedBy:"設計担当", BuiltBy:"施工担当", ProvidedBy:"提供元", PartOfSystem:"システム構成" },
  };
  const state = { language:"en", focusDepth:1, focusedNode:null, showEdgeLabels:true, showNodeLabels:true };
  const editState = { linkSource:null }; // pending “from” node for manual link
  const DIMENSION_DEFAULTS = ["System","Spatial","Responsibility","Vendor"]; // fallback dimensions for new graphs

  const debounce = (fn, ms=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

  /* ====== Cytoscape boot ======
     Why: create graph canvas with shared style from onexus-style.js */
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    style: NEXUS_STYLE, // provided by onexus-style.js
    minZoom: 0.2, maxZoom: 3, wheelSensitivity: 0.2,
  });
  window.cy = cy;

  /* ====== Minimap ======
     Why: quick navigation on large models */
  initNavigator();

  /* ====== Basic canvas gestures ====== */
  let lastTap = 0;
  cy.on("tap", (evt)=>{ const now=Date.now(); if (evt.target===cy && now-lastTap<300) cy.fit(undefined,50); lastTap=now; });

  /* ====== Node/edge taps ======
     Why: selection, details, and manual link completion */
  cy.on("tap","node",(evt)=>{
    // Manual link: click second node to open create wizard
    if (editState.linkSource && evt.target!==editState.linkSource) { hideContextMenu?.(); openEdgeWizard(editState.linkSource, evt.target, {mode:'create'}); return; }

    // Host bridge (WebView2): send selection to Revit add-in
    const d = evt.target.data();
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({ type:"select-node", id:d.id, revitInstanceIds:d.revitInstanceIds ?? [], revitInstanceUids:d.revitInstanceUids ?? [] });
    }

    state.focusedNode = evt.target; applyDepthFocus(state.focusedNode); updateDetailsForNode(state.focusedNode);
  });
  cy.on("tap","edge",(evt)=> updateDetailsForEdge(evt.target));
  cy.on("tap",(evt)=>{ if (evt.target===cy){ clearFocus(); setDetailsMessage("Click a node or relationship."); }});

  /* ====== i18n ======
     What: set node/edge display strings; Why: quick language toggle */
  function setLanguage(lang){
    state.language = lang;
    cy.nodes().forEach(n=>{
      const lbl = n.data("label");
      n.data("displayLabel", (lbl && (lbl[lang] ?? lbl["en"])) ?? n.data("id"));
    });
    cy.edges().forEach(e=>{
      const t = e.data("type");
      e.data("displayType", LABELS[lang][t] ?? t);
    });
    buildRelationshipLegend();
  }

  /* ====== Filters (category/dimension/relationship) ======
     Why: derive views from dense graphs */
  function buildCategoryFilter(){
    const select = document.getElementById("categoryFilter");
    select.innerHTML = `<option value="ALL">All Categories</option>`;
    [...new Set(cy.nodes().map(n=>n.data("category")))]
      .filter(Boolean).sort()
      .forEach(cat=>{
        const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat; select.appendChild(opt);
      });
  }
  function filterByCategory(cat){
    cy.nodes().forEach(n=> n.style("display", (cat==="ALL" || n.data("category")===cat) ? "element" : "none"));
    syncEdges(); if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }
  function filterByDimension(dim){
    cy.edges().forEach(e=> e.style("display", e.data("dimension")===dim ? "element":"none"));
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }
  let relationshipFilter = null;
  function filterByRelationshipType(type){
    relationshipFilter = relationshipFilter===type ? null : type;
    cy.edges().forEach(e=> e.style("display", !relationshipFilter || e.data("type")===relationshipFilter ? "element":"none"));
    if (state.focusedNode) applyDepthFocus(state.focusedNode);
    buildRelationshipLegend(); updateMetrics();
  }
  function clearRelationshipFilter(){ relationshipFilter=null; cy.edges().style("display","element"); if (state.focusedNode) applyDepthFocus(state.focusedNode); buildRelationshipLegend(); updateMetrics(); }
  function showAllEdges(){ relationshipFilter=null; cy.edges().style("display","element"); if (state.focusedNode) applyDepthFocus(state.focusedNode); buildRelationshipLegend(); updateMetrics(); }

  // Keep edges consistent with node visibility (why: avoid floating edges)
  const syncEdges = debounce(()=> {
    cy.edges().forEach(e=>{
      const vis = e.source().style("display")==="element" && e.target().style("display")==="element";
      e.style("display", vis ? "element":"none");
    });
  },60);

  /* ====== Layouts ======
     What: multiple readable arrangements; Why: switch perspectives quickly */
  function layoutCategorySwimlanes(){
    const cats={}; cy.nodes(':visible').forEach(n=>{ const c=n.data('category') ?? n.data('revitCategory') ?? 'Uncategorized'; (cats[c]??=[]).push(n.id()); });
    const categories=Object.keys(cats); const rows=categories.length; const colSize=Math.ceil(Math.sqrt(cy.nodes(':visible').length));
    categories.forEach((cat,rowIdx)=> cats[cat].forEach((id,i)=>{ const n=cy.getElementById(id); n.data('_laneRow',rowIdx); n.data('_laneCol',i%colSize); }));
    cy.layout({ name:'grid', rows, cols:colSize, position:n=>({row:n.data('_laneRow')??0,col:n.data('_laneCol')??0}), avoidOverlap:true, animate:true }).run();
  }
  function layoutDegreeRings(){ cy.layout({ name:'concentric', animate:true, concentric:n=>n.degree(), levelWidth:()=>2, minNodeSpacing:20 }).run(); }
  function layoutDependencyFlow(){
    const dirEdges = cy.edges(':visible').filter(e=>!!e.data('directional'));
    const touched = dirEdges.connectedNodes();
    let roots = touched.filter(n=> n.indegree()===0);
    if (roots.length===0) roots = touched.sort((a,b)=> b.outdegree()-a.outdegree()).slice(0,3);
    cy.layout({ name:'breadthfirst', roots, directed:true, spacingFactor:1.4, animate:true }).run();
  }
  function layoutAssemblyChains(){
    const T='PartOfSystem'; const edges=cy.edges(`[type = "${T}"]`); if(!edges.length) return layoutDegreeRings();
    const adj=new Map(), indeg=new Map(); cy.nodes(':visible').forEach(n=>{ adj.set(n.id(),[]); indeg.set(n.id(),0); });
    edges.forEach(e=>{ const s=e.data('source'), t=e.data('target'); adj.get(s)?.push(t); indeg.set(t,(indeg.get(t)??0)+1); });
    const roots=[]; adj.forEach((list,id)=>{ if(list.length>0 && (indeg.get(id)??0)===0) roots.push(id); }); if(!roots.length) roots.push(...adj.keys());
    const col=new Map(), visited=new Set(), depth=new Map(), q=[...roots]; roots.forEach((r,i)=>{ col.set(r,i); depth.set(r,0); });
    while(q.length){ const cur=q.shift(); if(!visited.has(cur)){ visited.add(cur); const d=depth.get(cur)??0; (adj.get(cur)??[]).forEach(n=>{ if(!visited.has(n)){ depth.set(n,d+1); if(!col.has(n)) col.set(n,col.get(cur)); q.push(n);} }); } }
    cy.nodes(':visible').forEach(n=>{ n.data('_chainCol', col.get(n.id())??0); n.data('_chainRow', depth.get(n.id())??0); });
    const cols=Math.max(...Array.from(col.values()))+1, rows=Math.max(...Array.from(depth.values()))+1;
    cy.layout({ name:'grid', rows, cols, position:n=>({row:n.data('_chainRow')??0,col:n.data('_chainCol')??0}), avoidOverlap:true, animate:true }).run();
  }
  function pickNestingEdgeType(){ for(const t of ['PartOfSystem','LocatedIn','DependsOn','Controls','Monitors','ConnectsTo']) if(cy.edges(`[type = "${t}"]`).length>0) return t; return null; }
  function buildNestingEdges(t){ let e=cy.edges(`[type = "${t}"]`); if(['DependsOn','Controls','Monitors','ConnectsTo'].includes(t)){ const d=e.filter(x=>!!x.data('directional')); if(d.length>0) e=d; } return e; }
  function findTreeRoots(nEdges,K=5){
    const inM=new Map(), outM=new Map(); nEdges.forEach(e=>{ const s=e.data('source'),t=e.data('target'); outM.set(s,(outM.get(s)??0)+1); inM.set(t,(inM.get(t)??0)+1); });
    const candidates=new Set(); nEdges.connectedNodes().forEach(n=>candidates.add(n.id()));
    const roots=[]; candidates.forEach(id=>{ if(!inM.get(id) && outM.get(id)) roots.push(id); });
    if(roots.length) return cy.collection(roots.map(id=>cy.getElementById(id)));
    const ranked=Array.from(candidates).sort((a,b)=>(outM.get(b)??0)-(outM.get(a)??0)).slice(0,Math.min(K,candidates.size));
    return cy.collection(ranked.map(id=>cy.getElementById(id)));
  }
  function layoutTreeNested(){
    const t=pickNestingEdgeType();
    if(!t){ cy.layout({name:'concentric',animate:true,concentric:n=>n.degree(),levelWidth:()=>2}).run(); showTransientMessage('Tree (Nested): no nesting relations found — showing Degree Rings.'); return; }
    const nEdges=buildNestingEdges(t); const roots=findTreeRoots(nEdges);
    cy.edges().removeClass('nestEdge'); cy.edges().removeClass('nonNestEdge'); nEdges.addClass('nestEdge'); cy.edges().not(nEdges).addClass('nonNestEdge');
    cy.layout({ name:'breadthfirst', roots, directed:true, spacingFactor:1.35, animate:true, padding:30 }).run();
    showTransientMessage(`Tree (Nested): using "${t}" as hierarchy relation.`);
  }

  /* ====== Toast ======
     Why: unobtrusive user feedback */
  function showTransientMessage(text, timeoutMs=1800){
    let el=document.getElementById('onexus-toast');
    if(!el){ el=document.createElement('div'); el.id='onexus-toast';
      Object.assign(el.style,{position:'absolute',right:'12px',bottom:'12px',background:'rgba(0,0,0,0.65)',color:'#fff',padding:'8px 10px',borderRadius:'6px',fontSize:'12px',zIndex:9999,pointerEvents:'none',maxWidth:'50vw'}); document.body.appendChild(el);
    }
    el.textContent=text; el.style.display='block'; clearTimeout(el._timer); el._timer=setTimeout(()=>el.style.display='none', timeoutMs);
  }

  /* ====== Layout switcher ======
     Why: entry point for UI dropdown */
  function applyLayout(type){
    const picks=(k=3)=> cy.nodes(':visible').sort((a,b)=>b.degree()-a.degree()).slice(0,k);
    const breadth=(roots)=>({ name:"breadthfirst", roots, directed:false, spacingFactor:1.4, animate:true });
    let layout=null;
    switch(type){
      case "system": { const roots=cy.nodes('[nodeType = "System"]'); layout=roots.length? breadth(roots) : (picks(3).length? breadth(picks(3)) : {name:"concentric",animate:true}); break; }
      case "responsibility": { const roots=cy.nodes('[nodeType = "Organization"]'); layout=roots.length? breadth(roots): breadth(picks(3)); break; }
      case "spatial": { const roots=cy.nodes('[nodeType = "Space"]'); layout=roots.length? breadth(roots): breadth(picks(3)); break; }
      case "tree_nested": return layoutTreeNested();
      case "category_lanes": return layoutCategorySwimlanes();
      case "degree_rings": return layoutDegreeRings();
      case "dependency_flow": return layoutDependencyFlow();
      case "assembly_chains": return layoutAssemblyChains();
      default: layout={ name:"cose", animate:true };
    }
    cy.layout(layout).run();
  }

  /* ====== Label visibility toggles ======
     Why: performance/readability at different zooms */
  function applyEdgeLabelVisibility(){ const o=state.showEdgeLabels?1:0; cy.edges().forEach(e=> e.style("text-opacity",o)); }
  function setEdgeLabelVisibility(show){ state.showEdgeLabels=!!show; applyEdgeLabelVisibility(); }
  function applyNodeLabelVisibility(){ const o=state.showNodeLabels?1:0; cy.nodes().forEach(n=> n.style("text-opacity",o)); }
  function setNodeLabelVisibility(show){ state.showNodeLabels=!!show; applyNodeLabelVisibility(); }

  /* ====== Data IO (JSON load/validate) ====== */
  function loadJSON(event){
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(e)=>{
      let data; try{ data=JSON.parse(e.target.result);} catch(err){ alert("Invalid JSON: "+err.message); return; }
      const {valid,errors}=validateOnexusJson(data); if(!valid){ alert("Schema errors:\n"+errors.join("\n")); return; }
      cy.elements().remove(); cy.add(data.elements.nodes); cy.add(data.elements.edges);
      setLanguage(state.language); buildCategoryFilter(); applyLayout("default"); cy.fit(undefined,50);
      applyEdgeLabelVisibility(); applyNodeLabelVisibility(); buildRelationshipLegend(); updateMetrics();
    };
    reader.readAsText(file);
  }
  function validateOnexusJson(data){
    const errors=[]; if(!data||!data.elements){ errors.push("Missing `elements`."); return {valid:false,errors}; }
    if(!Array.isArray(data.elements.nodes)) errors.push("`elements.nodes` must be an array.");
    if(!Array.isArray(data.elements.edges)) errors.push("`elements.edges` must be an array.");
    (data.elements.nodes??[]).forEach((n,i)=>{ const d=n?.data??{}; if(!d.id) errors.push(`nodes[${i}].data.id is required`); if(!d.nodeType) errors.push(`nodes[${i}].data.nodeType is required`); if(!d.category) errors.push(`nodes[${i}].data.category is required`); if(typeof d.label!=="object") errors.push(`nodes[${i}].data.label must be an object`);});
    (data.elements.edges??[]).forEach((e,i)=>{ const d=e?.data??{}; if(!d.id) errors.push(`edges[${i}].data.id is required`); if(!d.type) errors.push(`edges[${i}].data.type is required`); if(!d.dimension) errors.push(`edges[${i}].data.dimension is required`); if(!d.source) errors.push(`edges[${i}].data.source is required`); if(!d.target) errors.push(`edges[${i}].data.target is required`); if(typeof d.directional!=="boolean") errors.push(`edges[${i}].data.directional must be boolean`);});
    return { valid: errors.length===0, errors };
  }

  /* ====== Focus controls ======
     What: highlight N‑hop neighborhood; Why: reduce visual noise */
  function setFocusDepth(depth){ state.focusDepth=parseInt(depth,10)??1; document.getElementById("depthLabel").textContent=`${state.focusDepth}-hop`; if(state.focusedNode) applyDepthFocus(state.focusedNode); }
  function applyDepthFocus(node){
    cy.elements().addClass("faded");
    let neigh = node.closedNeighborhood().filter(":visible");
    if (state.focusDepth>=2){ const one=node.neighborhood().filter(":visible"); const two=one.neighborhood().filter(":visible"); neigh=neigh.union(two); }
    neigh.removeClass("faded");
  }
  function clearFocus(){ state.focusedNode=null; cy.elements().removeClass("faded"); }

  /* ====== Legend & Metrics ======
     Why: explain colors/types and show quick stats */
  const buildRelationshipLegend = debounce(()=>{
    const container=document.getElementById("legend"); if(!container) return;
    container.innerHTML=""; const seen=new Set();
    cy.edges(":visible").forEach(e=>{
      const type=e.data("type"); if(seen.has(type)) return; seen.add(type);
      const color=e.style("line-color"); const displayType=e.data("displayType") ?? type;
      const item=document.createElement("div"); item.className="legend-item"; if(relationshipFilter===type) item.classList.add("active");
      const line=document.createElement("div"); line.className="legend-line"; line.style.backgroundColor=color;
      const label=document.createElement("span"); label.textContent=displayType;
      item.addEventListener("click",()=> window.filterByRelationshipType?.(type));
      item.appendChild(line); item.appendChild(label); container.appendChild(item);
    });
  },80);
  function updateMetrics(){
    const box=document.getElementById("metrics"); if(!box) return;
    const tn=cy.nodes().length, vn=cy.nodes(":visible").length, te=cy.edges().length, ve=cy.edges(":visible").length;
    const density = vn>1 ? (ve/(vn*(vn-1))).toFixed(3) : "0";
    box.innerHTML = `<div>Total nodes: ${tn} (visible: ${vn})</div><div>Total edges: ${te} (visible: ${ve})</div><div>Density (visible): ${density}</div>`;
  }

  /* ====== Navigation & Export ======
     Why: quick framing and snapshot/export pipelines */
  const fitView=()=> cy.fit(undefined,50);
  const centerView=()=> cy.center();
  function resetView(){ applyLayout("default"); cy.fit(undefined,50); clearFocus(); }

  function download(filename, mime, dataUrlOrBlob){
    const a=document.createElement("a"); a.href= typeof dataUrlOrBlob==="string" ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
    a.download=filename; a.click(); setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
  }
  function exportPNG(){ const png=cy.png({full:true,scale:2,bg:THEMES[currentTheme].canvas}); download("onexus-graph.png","image/png",png); }
  function exportSVG(){ if(typeof cy.svg==="function"){ const svg=cy.svg({full:true}); download("onexus-graph.svg","image/svg+xml", new Blob([svg],{type:"image/svg+xml;charset=utf-8"})); } else { alert("SVG export requires cytoscape-svg plugin."); } }
  function exportJSON(){ const nodes=cy.nodes(":visible").map(n=>({data:n.data()})); const edges=cy.edges(":visible").map(e=>({data:e.data()})); const blob=new Blob([JSON.stringify({elements:{nodes,edges},meta:{exportedAt:new Date().toISOString()}},null,2)],{type:"application/json"}); download("onexus-graph.json","application/json",blob); }
  function exportCSV(){
    const rows=[["id","type","dimension","directional","source","target","phase","owner","risk","confidence","notes"]];
    cy.edges(":visible").forEach(e=>{ const d=e.data(); rows.push([d.id,d.type,d.dimension,d.directional?"1":"0",d.source,d.target,(d.phase??[]).join("\n"),d.owner??"",d.risk??"",d.confidence??"", (d.notes??"").replace(/\n/g," ")]); });
    const csv=rows.map(r=> r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    download("onexus-edges.csv","text/csv", new Blob([csv],{type:"text/csv"}));
  }
  function exportLayout(){ const pos=cy.nodes().map(n=>({id:n.id(),position:n.position()})); download("onexus-layout.json","application/json", new Blob([JSON.stringify({positions:pos},null,2)],{type:"application/json"})); }

  /* ====== Details panel ======
     Why: quick inspection of selected entity */
  function updateDetailsForNode(node){
    const d=node.data();
    setDetailsMessage(`<b>${d.displayLabel}</b><br>Type: ${d.nodeType ?? "-"}<br>Category: ${d.category ?? "-"}<br>Level: ${d.level ?? "-"}`);
  }
  function updateDetailsForEdge(edge){
    const d=edge.data();
    setDetailsMessage(`<b>${d.displayType}</b><br>Dimension: ${d.dimension ?? "-"}<br>Phase: ${(d.phase ?? []).join(", ")}<br>Owner: ${d.owner ?? "-"}<br>Confidence: ${d.confidence ?? "-"}<br>Risk: ${d.risk ?? "-"}`);
  }
  function setDetailsMessage(html){ const el=document.getElementById("details"); if(el) el.innerHTML=html; }

  /* ====== Minimap init ====== */
  function initNavigator(){
    const host=document.querySelector("#minimap"); if(!host || typeof cy.navigator!=="function") return;
    try{ cy.navigator({ container:"#minimap", viewLiveFramerate:0, thumbnailEventFramerate:30, thumbnailLiveFramerate:false, dblClickDelay:200 }); }catch(e){ console.warn("Navigator init failed:",e); }
  }

  /* ====== Host integration (WebView2) ======
     Why: allow Revit add-in to push graphs/positions/highlights */
  function loadGraphObject(graph){
    try{
      const res=typeof validateOnexusJson==='function' ? validateOnexusJson(graph) : {valid:true,errors:[]};
      if(res && res.valid===false){ console.error('ONEXUS schema errors:', res.errors); alert('Invalid ONEXUS JSON:\n'+res.errors.join('\n')); return; }
      const c=window.cy; if(!c){ console.error('Cytoscape not ready'); return; }
      c.elements().remove(); c.add(graph.elements?.nodes ?? []); c.add(graph.elements?.edges ?? []);
      window.setLanguage?.('en'); window.buildCategoryFilter?.(); window.applyTheme?.(localStorage.getItem('onexus.theme') ?? 'light'); window.applyLayout?.('default');
      cy.fit(undefined,50); window.setEdgeLabelVisibility?.(true); window.setNodeLabelVisibility?.(true);
    }catch(e){ console.error('Failed to load graph object:', e); alert('Failed to load graph: '+e.message); }
  }
  function applyLayoutPositions(positions){
    if(!Array.isArray(positions) || !positions.length) return;
    positions.forEach(p=>{ if(!p||!p.id) return; const n=cy.getElementById(p.id); if(n && n.nonempty && n.nonempty()){ if(p.position && typeof p.position.x==='number' && typeof p.position.y==='number') n.position(p.position); }});
    cy.fit(undefined,50);
  }

  /* ====== Manual relation UX ======
     What: create/edit/delete relations + reverse direction + toolbar chip
     Why: enable quick curation without leaving the viewer */
  function ensureLinkChip(){
    let chip=document.getElementById('onexus-link-chip');
    if(chip) return chip;
    const toolbar=document.getElementById('toolbar'); if(!toolbar) return null;
    chip=document.createElement('div'); chip.id='onexus-link-chip';
    Object.assign(chip.style,{display:'none',marginLeft:'8px',padding:'4px 8px',border:'1px solid var(--stroke)',borderRadius:'999px',background:'var(--bg-soft)',color:'var(--text-main)',fontSize:'12px',alignItems:'center',gap:'8px',whiteSpace:'nowrap',userSelect:'none'});
    const text=document.createElement('span'); text.id='onexus-link-chip-text';
    const btn=document.createElement('button'); btn.textContent='Cancel';
    Object.assign(btn.style,{marginLeft:'8px',padding:'2px 8px',borderRadius:'10px',border:'1px solid var(--stroke)',background:'var(--btn-bg)',cursor:'pointer',fontSize:'12px'});
    btn.addEventListener('click', ()=> cancelManualLink());
    chip.appendChild(text); chip.appendChild(btn); toolbar.appendChild(chip);
    return chip;
  }
  function updateLinkChip(){
    const chip=ensureLinkChip(); if(!chip) return;
    const text=document.getElementById('onexus-link-chip-text');
    if(editState.linkSource){ chip.style.display='flex'; text.textContent = `Linking from: ${editState.linkSource.data('displayLabel') ?? editState.linkSource.id()}`; }
    else { chip.style.display='none'; }
  }
  function beginManualLink(node){ cancelManualLink(); editState.linkSource=node; node.addClass('highlight'); updateLinkChip(); showTransientMessage('Pick a target node to connect…'); }
  function cancelManualLink(){ if(editState.linkSource) editState.linkSource.removeClass('highlight'); editState.linkSource=null; updateLinkChip(); }

  function deleteEdge(edge){
    if(!edge || !edge.nonempty || !edge.nonempty()) return;
    if(confirm('Delete this edge?')){ cy.remove(edge); buildRelationshipLegend(); updateMetrics(); setDetailsMessage('Edge deleted.'); }
  }
  function reverseEdge(edge){
    // Recreate with swapped endpoints (ensures arrow redraw to new target)
    if(!edge || !edge.nonempty || !edge.nonempty()) return;
    const d = {...edge.data()};
    const newData = {...d, source:d.target, target:d.source };
    const keepId = d.id;
    edge.remove();
    const e2 = cy.add({ data: newData });
    e2.data('id', keepId);
    const t = e2.data('type'); e2.data('displayType', LABELS[state.language][t] ?? t);
    e2.style('text-opacity', state.showEdgeLabels ? 1 : 0);
    buildRelationshipLegend(); updateMetrics(); updateDetailsForEdge(e2);
    showTransientMessage('Edge direction reversed.');
  }
  function uniqueEdgeId(base){ let id=base,k=1; const exists=()=>{ const col=cy.getElementById(id); return col && col.nonempty && col.nonempty(); }; while(exists()){ k+=1; id=`${base}-${k}`; } return id; }

  // Create/edit wizard: unified dialog for both flows
  function openEdgeWizard(sourceNode, targetNode, opts={}){
    const mode = opts.mode ?? 'create';
    const existingEdge = opts.edge ?? null;

    const srcId=sourceNode.id(), tgtId=targetNode.id();
    const typeOpts = [...new Set(cy.edges().map(e=>e.data('type')))].filter(Boolean);
    const dimOpts  = [...new Set(cy.edges().map(e=>e.data('dimension')))].filter(Boolean);
    const typeOptions = typeOpts.length ? typeOpts : ["Controls","Supplies","LocatedIn","DesignedBy","BuiltBy","ProvidedBy","PartOfSystem"];
    const dimOptions  = dimOpts.length  ? dimOpts  : DIMENSION_DEFAULTS;

    const defaultDim = (sourceNode.data('nodeType')==='Space' || targetNode.data('nodeType')==='Space') ? 'Spatial' : (dimOpts[0] ?? 'System');

    let overlay=document.getElementById('onexus-edge-wizard');
    if(!overlay){ overlay=document.createElement('div'); overlay.id='onexus-edge-wizard';
      Object.assign(overlay.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10060});
      document.body.appendChild(overlay);
    }
    const panel=document.createElement('div');
    Object.assign(panel.style,{background:'#fff',minWidth:'360px',maxWidth:'440px',borderRadius:'8px',padding:'12px',boxShadow:'0 12px 28px rgba(0,0,0,0.22)',fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',fontSize:'13px',color:'#111'});
    const title = mode==='edit' ? 'Edit relation' : 'Create relation';
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">${title}</div>
      <div style="margin-bottom:6px;"><b>From:</b> ${sourceNode.data('displayLabel') ?? srcId}</div>
      <div style="margin-bottom:10px;"><b>To:</b> ${targetNode.data('displayLabel') ?? tgtId}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <label>Type
          <select id="rel-type" style="width:100%;margin-top:4px;">
            ${typeOptions.map(t=>`<option value="${t}">${t}</option>`).join('')}
          </select>
        </label>
        <label>Dimension
          <select id="rel-dim" style="width:100%;margin-top:4px;">
            ${dimOptions.map(d=>`<option value="${d}">${d}</option>`).join('')}
          </select>
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <input id="rel-dir" type="checkbox" checked> Directional (source → target)
      </label>
      <label style="display:block;margin-bottom:10px;">
        <div style="margin-bottom:4px;">Notes (optional)</div>
        <textarea id="rel-notes" rows="3" style="width:100%;"></textarea>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="rel-cancel" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;">Cancel</button>
        <button id="rel-apply" style="padding:6px 10px;border:0;border-radius:6px;background:#111827;color:#fff;cursor:pointer;">${mode==='edit'?'Save':'Create'}</button>
      </div>`;
    overlay.innerHTML=''; overlay.appendChild(panel);

    const $type=panel.querySelector('#rel-type'), $dim=panel.querySelector('#rel-dim'), $dir=panel.querySelector('#rel-dir'), $notes=panel.querySelector('#rel-notes');

    if(mode==='edit' && existingEdge){
      const d=existingEdge.data();
      if([...$type.options].some(o=>o.value===d.type)) $type.value=d.type;
      if([...$dim.options].some(o=>o.value===d.dimension)) $dim.value=d.dimension; else $dim.value=d.dimension ?? defaultDim;
      $dir.checked=!!d.directional; $notes.value=d.notes ?? "";
    }else{
      $dim.value=defaultDim; $dir.checked=true; $notes.value="";
    }

    const close=()=>{ overlay.remove(); cancelManualLink(); };
    panel.querySelector('#rel-cancel').addEventListener('click', close);

    panel.querySelector('#rel-apply').addEventListener('click', ()=>{
      const type=$type.value, dimension=$dim.value, directional=$dir.checked, notes=$notes.value ?? "";

      if(mode==='edit' && existingEdge){
        existingEdge.data({ ...existingEdge.data(), type, dimension, directional:!!directional, notes });
        const t=existingEdge.data('type'); existingEdge.data('displayType', LABELS[state.language][t] ?? t);
        existingEdge.style('text-opacity', state.showEdgeLabels ? 1 : 0);
        buildRelationshipLegend(); updateMetrics(); updateDetailsForEdge(existingEdge);
        showTransientMessage('Relation updated.'); close(); return;
      }

      // Create: prevent exact duplicates (type+src+tgt)
      const dup=cy.edges().filter(e=> e.data('source')===srcId && e.data('target')===tgtId && e.data('type')===type);
      if(dup.length>0){ alert('An identical edge already exists.'); return; }

      const id=uniqueEdgeId(`e_${srcId}_${type}_${tgtId}`);
      const edgeData={ id, type, dimension, directional:!!directional, source:srcId, target:tgtId, notes };
      const edgeEle=cy.add({ data:edgeData });
      const t=edgeData.type; edgeEle.data('displayType', LABELS[state.language][t] ?? t);
      edgeEle.style('text-opacity', state.showEdgeLabels ? 1 : 0);
      buildRelationshipLegend(); updateMetrics(); updateDetailsForEdge(edgeEle);
      showTransientMessage(`Added: ${edgeEle.data('displayType')} (${edgeData.source} → ${edgeData.target})`);
      close();
    });
  }

  /* ====== Context menu ======
     What: node actions, edge actions (edit/reverse/delete), background actions */
  function createContextMenu(){
    const container=document.getElementById('cy'); if(!container) return;
    let menu=document.getElementById('cy-context-menu');
    if(!menu){
      menu=document.createElement('div'); menu.id='cy-context-menu'; document.body.appendChild(menu);
      Object.assign(menu.style,{position:'fixed',display:'none',minWidth:'200px',background:'#fff',color:'#111',border:'1px solid rgba(0,0,0,0.12)',boxShadow:'0 6px 14px rgba(0,0,0,0.14)',borderRadius:'6px',padding:'6px 0',zIndex:10050,fontSize:'13px'});
      const style=document.createElement('style'); style.textContent=`
#cy-context-menu .cm-item{ padding:8px 12px; cursor:pointer; white-space:nowrap }
#cy-context-menu .cm-item:hover{ background:rgba(0,0,0,0.05) }
#cy-context-menu .cm-divider{ height:1px; margin:6px 0; background:rgba(0,0,0,0.06) }`; document.head.appendChild(style);
    }
    function hide(){ menu.style.display='none'; } window.hideContextMenu = hide;
    function render(items,x,y){
      menu.innerHTML=''; items.forEach(it=>{
        if(it.type==='divider'){ const d=document.createElement('div'); d.className='cm-divider'; menu.appendChild(d); return; }
        const el=document.createElement('div'); el.className='cm-item'; el.textContent=it.label;
        el.addEventListener('click',(ev)=>{ ev.stopPropagation(); hide(); try{ it.action&&it.action(); }catch(e){ console.error('Context menu action failed',e);} });
        menu.appendChild(el);
      });
      menu.style.display='block'; const rect=menu.getBoundingClientRect(); const ww=innerWidth, wh=innerHeight;
      let left=x, top=y; if(left+rect.width>ww) left=Math.max(8,ww-rect.width-8); if(top+rect.height>wh) top=Math.max(8,wh-rect.height-8);
      menu.style.left=left+'px'; menu.style.top=top+'px';
    }
    function itemsForNode(node){
      const base=[
        { label:'Focus (1-hop)', action:()=>{ setFocusDepth(1); state.focusedNode=node; applyDepthFocus(node);} },
        { label:'Focus (2-hop)', action:()=>{ setFocusDepth(2); state.focusedNode=node; applyDepthFocus(node);} },
        { label:'Center on node', action:()=>{ if(node && node.nonempty && node.nonempty()) cy.center(node);} },
        { label:'Select (host)', action:()=>{ if(window.chrome&&window.chrome.webview){ window.chrome.webview.postMessage({type:'select-node',id:node.id(),revitInstanceIds:node.data('revitInstanceIds')??[],revitInstanceUids:node.data('revitInstanceUids')??[]}); } } },
        { type:'divider' },
        { label:'Export node JSON', action:()=>{ const payload={elements:{nodes:[{data:node.data()}],edges:[]},meta:{exportedAt:new Date().toISOString()}}; download(node.id()+'.json','application/json', new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})); } }
      ];
      const linkItems=[{type:'divider'}];
      if(!editState.linkSource) linkItems.push({ label:'Start relation from here…', action:()=> beginManualLink(node) });
      else if(editState.linkSource.id()===node.id()) linkItems.push({ label:'Cancel pending link', action:()=> cancelManualLink() });
      else linkItems.push({ label:'Connect relation to here…', action:()=> openEdgeWizard(editState.linkSource, node, {mode:'create'}) }, { label:'Cancel pending link', action:()=> cancelManualLink() });
      return base.concat(linkItems);
    }
    function itemsForEdge(edge){
      return [
        { label:'Edit relation…', action:()=> openEdgeWizard(edge.source(), edge.target(), {mode:'edit', edge}) },
        { label:'Reverse direction', action:()=> reverseEdge(edge) },
        { type:'divider' },
        { label:'Delete edge', action:()=> deleteEdge(edge) },
      ];
    }

    cy.on('cxttap','node',(evt)=>{ const ex=evt.originalEvent?evt.originalEvent.clientX:window.event.clientX; const ey=evt.originalEvent?evt.originalEvent.clientY:window.event.clientY; render(itemsForNode(evt.target),ex,ey); });
    cy.on('cxttap','edge',(evt)=>{ const ex=evt.originalEvent?evt.originalEvent.clientX:window.event.clientX; const ey=evt.originalEvent?evt.originalEvent.clientY:window.event.clientY; render(itemsForEdge(evt.target),ex,ey); });
    cy.on('cxttap',(evt)=>{ if(evt.target===cy){ const ex=evt.originalEvent?evt.originalEvent.clientX:window.event.clientX; const ey=evt.originalEvent?evt.originalEvent.clientY:window.event.clientY; render(itemsForBackground(),ex,ey); }});

    document.addEventListener('contextmenu',(ev)=>{ try{ const t=ev.target; if(t && t.closest && (t.closest('#cy')||t.closest('#cy-context-menu'))) ev.preventDefault(); }catch{} });
    document.addEventListener('click', hide);
    document.addEventListener('keydown',(ev)=>{ if(ev.key==='Escape'){ hide(); cancelManualLink(); }});

    function itemsForBackground(){
      return [
        { label:'Fit view', action:fitView }, { label:'Center view', action:centerView }, { label:'Reset view', action:resetView },
        { type:'divider' },
        { label: state.showEdgeLabels ? 'Hide edge labels':'Show edge labels', action:()=> setEdgeLabelVisibility(!state.showEdgeLabels) },
        { label: state.showNodeLabels ? 'Hide node labels':'Show node labels', action:()=> setNodeLabelVisibility(!state.showNodeLabels) },
        { type:'divider' },
        { label:'Show all edges', action:showAllEdges }, { label:'Clear relationship filter', action:clearRelationshipFilter },
        { type:'divider' },
        { label:'Export PNG', action:exportPNG }, { label:'Export JSON (visible)', action:exportJSON }, { label:'Export CSV (edges)', action:exportCSV }, { label:'Export layout', action:exportLayout },
        { type:'divider' },
        { label:'Layout: System', action:()=> applyLayout('system') },
        { label:'Layout: Responsibility', action:()=> applyLayout('responsibility') },
        { label:'Layout: Spatial', action:()=> applyLayout('spatial') },
        { label:'Layout: Tree (Nested)', action:()=> applyLayout('tree_nested') },
        { label:'Layout: Category lanes', action:()=> applyLayout('category_lanes') },
        { label:'Layout: Degree rings', action:()=> applyLayout('degree_rings') },
      ];
    }
  }
  createContextMenu();

  /* ====== Public API hooks for index.html and host ====== */
  window.setLanguage = setLanguage;
  window.applyLayout = applyLayout;
  window.loadJSON = loadJSON;
  window.buildCategoryFilter = buildCategoryFilter;
  window.filterByCategory = filterByCategory;
  window.filterByDimension = filterByDimension;
  window.filterByRelationshipType = filterByRelationshipType;
  window.clearRelationshipFilter = clearRelationshipFilter;
  window.showAllEdges = showAllEdges;
  window.fitView = fitView;
  window.centerView = centerView;
  window.resetView = resetView;
  window.setFocusDepth = setFocusDepth;
  window.setEdgeLabelVisibility = setEdgeLabelVisibility;
  window.setNodeLabelVisibility = setNodeLabelVisibility;
  window.exportPNG = exportPNG;
  window.exportSVG = exportSVG;
  window.exportJSON = exportJSON;
  window.exportCSV = exportCSV;
  window.exportLayout = exportLayout;
  window.onexusLoadGraph = loadGraphObject;
  window.applyLayoutPositions = applyLayoutPositions;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message',(e)=>{
      if(!e||!e.data) return;
      if(e.data.type==='onexus-graph'){ loadGraphObject(e.data.graph); return; }
      if(e.data.type==='highlight-nodes'){ const ids=new Set(e.data.ids??[]); cy.nodes().removeClass('highlight'); const hits=cy.nodes().filter(n=>ids.has(n.id())); hits.addClass('highlight'); if(hits.nonempty && hits.nonempty()) cy.fit(hits,60); return; }
      if(e.data.type==='apply-layout'){ const positions=e.data.positions??[]; if(Array.isArray(positions)&&positions.length) window.applyLayoutPositions(positions); return; }
    });
  }
})();