#!/usr/bin/env python3
"""Generate PolarPath frontend index.html — MapLibre globe version."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "..", "frontend", "index.html")

parts = []
parts.append("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PolarPath — SIC Forecast Viewer</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#c9d1d9}
#map{width:100%;height:100%}
.ctrl{position:absolute;top:12px;left:12px;background:rgba(13,17,23,.92);border:1px solid #30363d;border-radius:8px;padding:10px 14px;z-index:10;backdrop-filter:blur(6px);min-width:210px;user-select:none}
.ctrl h3{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#8b949e;margin-bottom:5px;font-weight:600}
.sep{height:1px;background:#30363d;margin:7px 0}
.lr{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.lr input[type=checkbox]{accent-color:#58a6ff;width:14px;height:14px}
.lr label{font-size:12px;cursor:pointer;display:flex;align-items:center;gap:5px;flex:1}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.or{display:flex;align-items:center;gap:4px;margin:1px 0 5px 22px}
.or input[type=range]{flex:1;height:3px;accent-color:#58a6ff;cursor:pointer}
.or span{font-size:9px;color:#8b949e;min-width:28px;text-align:right}
.mt{display:flex;border:1px solid #30363d;border-radius:5px;overflow:hidden;margin-bottom:4px}
.mb{flex:1;padding:4px 6px;font-size:10px;text-align:center;cursor:pointer;background:#0d1117;color:#8b949e;border:none;transition:all .12s}
.mb.on{background:#1f6feb;color:#fff}
.mb:hover:not(.on){background:#21262d}
.dsec{display:flex;flex-direction:column;gap:4px}
#dl{font-size:12px;font-weight:600;color:#e6edf3;text-align:center}
.dr{display:flex;align-items:center;gap:6px}
#pb{background:#238636;color:#fff;border:none;border-radius:4px;padding:3px 10px;font-size:10px;cursor:pointer}
#pb:hover{background:#2ea043}
#dsl{flex:1;accent-color:#58a6ff;cursor:pointer}
#tt{position:fixed;pointer-events:none;background:rgba(13,17,23,.95);border:1px solid #30363d;border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.5;display:none;z-index:100;max-width:210px;backdrop-filter:blur(4px)}
.tl{color:#8b949e}.tv{color:#e6edf3;font-weight:500}
#pc{position:absolute;top:12px;right:12px;z-index:10;display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 24px);overflow-y:auto;scrollbar-width:thin}
.pn{background:rgba(13,17,23,.94);border:1px solid #30363d;border-radius:7px;padding:9px 11px;font-size:11px;line-height:1.5;min-width:170px;backdrop-filter:blur(4px);position:relative}
.pn .cx{position:absolute;top:3px;right:5px;background:none;border:none;color:#8b949e;cursor:pointer;font-size:13px;padding:2px}
.pn .cx:hover{color:#f85149}
.pl{color:#8b949e}.pv{color:#e6edf3;font-weight:500}
.lg{position:absolute;bottom:14px;left:14px;background:rgba(13,17,23,.92);border:1px solid #30363d;border-radius:7px;padding:8px 12px;z-index:10;backdrop-filter:blur(4px)}
.lg .lgt{font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:#8b949e;margin-bottom:4px;font-weight:600}
.lg .lgi{display:flex;align-items:center;gap:6px;margin-bottom:2px;font-size:10px}
.lg .lgs{width:54px;height:9px;border-radius:2px;border:1px solid #30363d}
.lg .lgl{color:#8b949e;font-size:9px}
.sbo{position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;display:none;background:#0a0a0a}
.sbg{display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:4px;padding:4px;width:100%;height:100%}
.sbc{position:relative;overflow:hidden;border:1px solid #30363d;border-radius:4px}
.sbc canvas{width:100%;height:100%}
.sbc .sl{position:absolute;top:4px;left:6px;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;z-index:2;background:rgba(13,17,23,.8)}
.maplibregl-popup-content{background:rgba(13,17,23,.95)!important;border:1px solid #30363d!important;border-radius:6px!important;color:#c9d1d9!important;font-size:11px!important;padding:8px 10px!important;line-height:1.5!important}
.maplibregl-popup-tip{border-top-color:rgba(13,17,23,.95)!important}
</style>
</head>
<body>
<div id="map"></div>
""")

parts.append("""
<div class="ctrl">
  <h3>PolarPath SIC Viewer</h3><div class="sep"></div>
  <div id="lc"></div><div class="sep"></div>
  <h3>Display</h3>
  <div class="mt"><button class="mb on" data-m="overlay">Overlay</button><button class="mb" data-m="side-by-side">Side-by-side</button></div>
  <div class="sep"></div>
  <h3>Date</h3>
  <div class="dsec"><div id="dl"></div><div class="dr"><button id="pb">&#9654; Play</button><input type="range" id="dsl" min="0" max="29" value="0"></div></div>
</div>
<div id="tt"></div><div id="pc"></div>
<div class="lg" id="lg"></div>
<div class="sbo" id="sbo"><div class="sbg" id="sbg"></div></div>

<script src="https://unpkg.com/maplibre-gl/dist/maplibre-gl.js"></script>
<script>
(function(){
"use strict";

var LY=["actual","predicted","diff","uncertainty"];
var LC={actual:"#58a6ff",predicted:"#3fb950",diff:"#f85149",uncertainty:"#d29922"};
var COORDS=[[-10,-50],[80,-50],[80,-75],[-10,-75]];
var dates=[],ci=0,playing=false,tmr=null,md="overlay",ls={};
var latA=[],lonA=[],stns=[],coast=null,vals=null,confThr=null;
var map,sicSources={};

function initL(){LY.forEach(function(l){ls[l]={v:l!=="uncertainty",o:.75};});}

function buildLC(){
  var c=document.getElementById("lc");c.innerHTML="";
  LY.forEach(function(L){
    var r=document.createElement("div");r.className="lr";
    var cb=document.createElement("input");cb.type="checkbox";cb.checked=ls[L].v;cb.id="c-"+L;
    cb.onchange=function(){ls[L].v=cb.checked;updateLayers();updLg();};
    var lb=document.createElement("label");lb.htmlFor="c-"+L;
    var d=document.createElement("span");d.className="dot";d.style.background=LC[L];
    var n=document.createElement("span");n.textContent=L[0].toUpperCase()+L.slice(1);
    lb.appendChild(d);lb.appendChild(n);r.appendChild(cb);r.appendChild(lb);c.appendChild(r);
    var o=document.createElement("div");o.className="or";
    var s=document.createElement("input");s.type="range";s.min="0";s.max="100";
    s.value=Math.round(ls[L].o*100);
    var sp=document.createElement("span");sp.textContent=s.value+"%";
    s.oninput=function(){ls[L].o=s.value/100;sp.textContent=s.value+"%";updateLayers();};
    o.appendChild(s);o.appendChild(sp);c.appendChild(o);
  });
}

function setupMd(){
  document.querySelectorAll(".mb").forEach(function(b){
    b.onclick=function(){
      document.querySelectorAll(".mb").forEach(function(x){x.classList.remove("on")});
      b.classList.add("on");md=b.dataset.m;render();
    };
  });
}

function setupDt(){
  document.getElementById("dsl").oninput=function(){ci=+this.value;updDl();loadDt();};
  document.getElementById("pb").onclick=function(){playing?stopP():startP();};
}
function startP(){
  playing=true;document.getElementById("pb").innerHTML="&#9646;&#9646; Pause";
  tmr=setInterval(function(){
    ci=(ci+1)%dates.length;document.getElementById("dsl").value=ci;updDl();loadDt();
  },250);
}
function stopP(){
  playing=false;document.getElementById("pb").innerHTML="&#9654; Play";
  if(tmr)clearInterval(tmr);tmr=null;
}
function updDl(){document.getElementById("dl").textContent=dates[ci]||"--";}

async function loadDates(){
  var r=await fetch("data/values/date_index.json");
  if(r.ok){dates=await r.json();}
  else{dates=[];for(var i=0;i<30;i++)dates.push("2025-01-01");}
  document.getElementById("dsl").max=dates.length-1;updDl();
}

async function loadData(){
  var a=await Promise.all([
    fetch("data/lat.json"),fetch("data/lon.json"),
    fetch("data/stations.json"),
    fetch("data/coastline.json").catch(function(){return null}),
    fetch("data/confidence_thresholds.json").catch(function(){return null})
  ]);
  latA=await a[0].json();lonA=await a[1].json();
  stns=await a[2].json();
  if(a[3]&&a[3].ok)coast=await a[3].json();
  if(a[4]&&a[4].ok)confThr=await a[4].json();
}

function confLabel(c){
  if(c===255||c===null||c===undefined)return"--";
  if(!confThr)return c===0?"HIGH":c===1?"MEDIUM":"LOW";
  return c===0?"HIGH":c===1?"MEDIUM":"LOW";
}
""")

parts.append("""
function setupMap(){
  map=new maplibregl.Map({
    container:"map",
    style:{
      version:8,
      sources:{
        osm:{type:"raster",tiles:["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],tileSize:256,attribution:"CARTO"}
      },
      layers:[{id:"base",type:"raster",source:"osm",paint:{"raster-opacity":0.7}}]
    },
    center:[35,-62.5],
    zoom:3.5,
    maxBounds:[-180,-85,180,0],
    pitch:0,bearing:0
  });

  map.on("load",function(){
    if(coast&&coast.features){
      map.addSource("coast",{type:"geojson",data:coast});
      map.addLayer({id:"coast-fill",type:"fill",source:"coast",
        paint:{"fill-color":"#2d3748","fill-opacity":0.8}});
      map.addLayer({id:"coast-line",type:"line",source:"coast",
        paint:{"line-color":"#718096","line-width":1}});
    }

    map.addSource("roi",{type:"geojson",data:{
      type:"Feature",geometry:{type:"Polygon",coordinates:[[
        [-10,-50],[80,-50],[80,-75],[-10,-75],[-10,-50]
      ]]}
    }});
    map.addLayer({id:"roi-border",type:"line",source:"roi",
      paint:{"line-color":"#4a7fb5","line-width":2,"line-dasharray":[4,2]}});
    map.addLayer({id:"roi-fill",type:"fill",source:"roi",
      paint:{"fill-color":"#0b2545","fill-opacity":0.15}});

    addGraticule();
    addStations();
    loadDt();
    updateSIC();
  });

  map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),"top-right");

  map.on("mousemove",function(e){
    if(!vals)return;
    var ll=e.lngLat;
    if(ll.lng<-10||ll.lng>80||ll.lat<-75||ll.lat>-50){
      document.getElementById("tt").style.display="none";return;
    }
    var n=findNear(ll.lat,ll.lng);
    var a=gval("actual",n.li,n.lj),p=gval("predicted",n.li,n.lj);
    var d=gval("diff",n.li,n.lj),c=gval("uncertainty",n.li,n.lj);
    var tip=document.getElementById("tt");
    tip.innerHTML='<div><span class="tl">Lat:</span> <span class="tv">'+n.lat.toFixed(2)+'\\u00B0</span></div>'
      +'<div><span class="tl">Lon:</span> <span class="tv">'+n.lon.toFixed(2)+'\\u00B0</span></div>'
      +'<div style="margin-top:3px"><span class="tl">Actual:</span> <span class="tv">'+fv(a)+'</span></div>'
      +'<div><span class="tl">Predicted:</span> <span class="tv">'+fv(p)+'</span></div>'
      +'<div><span class="tl">Diff:</span> <span class="tv">'+fv(d)+'</span></div>'
      +'<div><span class="tl">Uncertainty (std):</span> <span class="tv">'+fv(c)+'</span></div>';
    tip.style.display="block";
    var tx=e.originalEvent.clientX+14,ty=e.originalEvent.clientY-10;
    if(tx+210>window.innerWidth)tx=e.originalEvent.clientX-220;
    if(ty+110>window.innerHeight)ty=e.originalEvent.clientY-110;
    tip.style.left=tx+"px";tip.style.top=ty+"px";
  });
  map.on("mouseleave",function(){document.getElementById("tt").style.display="none";});
  map.on("mouseout",function(){document.getElementById("tt").style.display="none";});

  map.on("click",function(e){
    if(!vals)return;
    var ll=e.lngLat;
    if(ll.lng<-10||ll.lng>80||ll.lat<-75||ll.lat>-50)return;
    var n=findNear(ll.lat,ll.lng);
    pinPanel(n);
  });
}
""")

parts.append("""
function addGraticule(){
  var feats=[];
  for(var lat=-75;lat<=-50;lat+=5){
    feats.push({type:"Feature",geometry:{type:"LineString",coordinates:[[-10,lat],[80,lat]]}});
  }
  for(var lon=-10;lon<=80;lon+=10){
    feats.push({type:"Feature",geometry:{type:"LineString",coordinates":[[lon,-75],[lon,-50]]}});
  }
  map.addSource("grat",{type:"geojson",data:{type:"FeatureCollection",features:feats}});
  map.addLayer({id:"grat-lines",type:"line",source:"grat",
    paint:{"line-color":"#1e4a7a","line-width":0.5,"line-dasharray":[4,4]},beforeLayer:"coast-fill"});
}

function addStations(){
  var fc={type:"FeatureCollection",features:stns.map(function(st){
    return{type:"Feature",geometry:{type:"Point",coordinates:[st.lon,st.lat]},
      properties:{name:st.name,highlight:st.highlight?true:false}};
  })};
  map.addSource("stns",{type:"geojson",data:fc});
  map.addLayer({id:"stns-circle",type:"circle",source:"stns",
    paint:{
      "circle-radius":["case",["get","highlight"],6,4],
      "circle-color":["case",["get","highlight"],"#f85149","#a0aec0"],
      "circle-stroke-color":["case",["get","highlight"],"#ff7b72","#cbd5e0"],
      "circle-stroke-width":1
    }
  });
  map.addLayer({id:"stns-label",type:"symbol",source:"stns",
    layout:{
      "text-field":["get","name"],
      "text-offset":[1.2,0],
      "text-anchor":"left",
      "text-size":["case",["get","highlight"],12,10]
    },
    paint:{
      "text-color":["case",["get","highlight"],"#ff7b72","#a0aec0"],
      "text-halo-color":"rgba(13,17,23,0.8)",
      "text-halo-width":2
    }
  });
}
""")

parts.append("""
function updateSIC(){
  if(!dates.length)return;
  var ds=dates[ci];
  LY.forEach(function(layer){
    var sid="sic-"+layer;
    var lid="sic-"+layer+"-layer";
    if(map.getSource(sid))map.removeSource(sid);
    if(map.getLayer(lid))map.removeLayer(lid);
    map.addSource(sid,{
      type:"image",
      url:"data/frames/"+ds+"_"+layer+".png",
      coordinates:COORDS
    });
    map.addLayer({
      id:lid,type:"raster",source:sid,
      paint:{"raster-opacity":ls[layer].o,"raster-fade-duration":0}
    });
  });
}

function updateLayers(){
  LY.forEach(function(layer){
    var lid="sic-"+layer+"-layer";
    if(map.getLayer(lid)){
      map.setPaintProperty(lid,"raster-opacity",ls[layer].v?ls[layer].o:0);
    }
  });
  render();
}
""")

parts.append("""
function render(){
  if(md==="overlay"){
    document.getElementById("sbo").style.display="none";
    document.getElementById("map").style.display=null;
    LY.forEach(function(layer){
      var lid="sic-"+layer+"-layer";
      if(map.getLayer(lid)){
        map.setPaintProperty(lid,"raster-opacity",ls[layer].v?ls[layer].o:0);
      }
    });
  }else{
    document.getElementById("map").style.display="none";
    renderSBS();
  }
  updLg();
}

function renderSBS(){
  var grid=document.getElementById("sbg");grid.innerHTML="";
  var vis=LY.filter(function(l){return ls[l].v;});
  if(!vis.length){
    document.getElementById("sbo").style.display="none";
    document.getElementById("map").style.display=null;return;
  }
  document.getElementById("sbo").style.display="block";
  var ds=dates[ci];
  vis.forEach(function(layer){
    var cell=document.createElement("div");cell.className="sbc";
    var lbl=document.createElement("div");lbl.className="sl";
    lbl.textContent=layer;lbl.style.color=LC[layer];cell.appendChild(lbl);

    var canvas=document.createElement("canvas");
    canvas.width=361;canvas.height=101;
    var ctx=canvas.getContext("2d");
    var img=new Image();
    img.onload=function(){ctx.drawImage(img,0,0);};
    img.src="data/frames/"+ds+"_"+layer+".png";
    cell.appendChild(canvas);
    grid.appendChild(cell);
  });
}
""")

parts.append("""
function updLg(){
  var b=document.getElementById("lg");
  var vis=LY.filter(function(l){return ls[l].v;});
  if(!vis.length){b.style.display="none";return;}b.style.display="";
  var h='<div class="lgt">Legend</div>';
  vis.forEach(function(l){
    if(l==="actual"||l==="predicted")
      h+='<div class="lgi"><span class="lgs" style="background:linear-gradient(to right,#0a1628,#ffffff)"></span><span class="lgl">'+l+' (SIC 0-1)</span></div>';
    else if(l==="diff")
      h+='<div class="lgi"><span class="lgs" style="background:linear-gradient(to right,#2166ac,#f7f7f7,#b2182b)"></span><span class="lgl">diff (under/over)</span></div>';
    else if(l==="uncertainty")
      h+='<div class="lgi"><span class="lgs" style="background:linear-gradient(to right,#1a1a2e,#ff8c00)"></span><span class="lgl">uncertainty (std)</span></div>';
  });
  b.innerHTML=h;
}

async function loadDt(){
  if(!dates.length)return;
  var ds=dates[ci];
  try{var r=await fetch("data/values/"+ds+".json");vals=await r.json();}
  catch(e){vals=null;}
  updateSIC();render();
}

function findNear(lat,lon){
  var bI=0,bJ=0,bD=Infinity;
  for(var i=0;i<latA.length;i++){var d=Math.abs(latA[i]-lat);if(d<bD){bD=d;bI=i;}}
  bD=Infinity;
  for(var j=0;j<lonA.length;j++){var d=Math.abs(lonA[j]-lon);if(d<bD){bD=d;bJ=j;}}
  return{li:bI,lj:bJ,lat:latA[bI],lon:lonA[bJ]};
}

function gval(layer,li,lj){
  if(!vals||!vals[layer])return null;
  return vals[layer][li]?vals[layer][li][lj]:null;
}
function fv(v){return v===null||v===undefined?"--":typeof v==="number"?v.toFixed(4):String(v);}

function pinPanel(n){
  var c=document.getElementById("pc");
  var id="p"+Date.now();
  var a=gval("actual",n.li,n.lj),p=gval("predicted",n.li,n.lj);
  var d=gval("diff",n.li,n.lj),u=gval("uncertainty",n.li,n.lj);
  var el=document.createElement("div");el.className="pn";el.id=id;
  el.innerHTML='<button class="cx" title="Close">&times;</button>'
    +'<div style="font-weight:600;margin-bottom:3px;color:#e6edf3">'+dates[ci]+'</div>'
    +'<div><span class="pl">Lat:</span> <span class="pv">'+n.lat.toFixed(2)+'\\u00B0</span></div>'
    +'<div><span class="pl">Lon:</span> <span class="pv">'+n.lon.toFixed(2)+'\\u00B0</span></div>'
    +'<div style="margin-top:2px"><span class="pl">Actual:</span> <span class="pv">'+fv(a)+'</span></div>'
    +'<div><span class="pl">Predicted:</span> <span class="pv">'+fv(p)+'</span></div>'
    +'<div><span class="pl">Diff:</span> <span class="pv">'+fv(d)+'</span></div>'
    +'<div><span class="pl">Uncertainty (std):</span> <span class="pv">'+fv(u)+'</span></div>';
  el.querySelector(".cx").onclick=function(){el.remove();};
  c.appendChild(el);
}

async function init(){
  initL();buildLC();setupMd();setupDt();
  await loadData();await loadDates();
  setupMap();updLg();
}
init();
})();
</script>
</body>
</html>
""")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("".join(parts))

print(f"Wrote {OUT} ({os.path.getsize(OUT)} bytes)")
