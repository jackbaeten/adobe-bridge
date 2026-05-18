// ID>AE Bridge - InDesign ExtendScript
// Reads selected items and returns JSON for the bridge

var BRIDGE_ID = "com.idbridge.main";

function esc(s) {
    if (!s) return "";
    return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')
        .replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\t/g,"\\t");
}

function colorRGB(c) {
    try {
        if (!c || c === NothingEnum.nothing) return [0,0,0];
        var sp = c.space, v = c.colorValue;
        if (sp === ColorSpace.RGB) return [Math.round(v[0]),Math.round(v[1]),Math.round(v[2])];
        if (sp === ColorSpace.CMYK) {
            var cy=v[0]/100,mg=v[1]/100,ye=v[2]/100,bk=v[3]/100;
            return [Math.round(255*(1-cy)*(1-bk)),Math.round(255*(1-mg)*(1-bk)),Math.round(255*(1-ye)*(1-bk))];
        }
    } catch(e) {}
    return [0,0,0];
}

function getFill(item) {
    try { var fc=item.fillColor; if(!fc||fc===NothingEnum.nothing||fc.name==="None") return null; return colorRGB(fc); } catch(e){return null;}
}
function getStroke(item) {
    try { if(!item.strokeColor||item.strokeWeight<=0) return null; var sc=item.strokeColor; if(sc===NothingEnum.nothing||sc.name==="None") return null; return {color:colorRGB(sc),width:item.strokeWeight}; } catch(e){return null;}
}
function getOpacity(item) { try { return item.transparencySettings.blendingSettings.opacity; } catch(e){return 100;} }
function getRotation(item) { try { return item.rotationAngle||0; } catch(e){return 0;} }

function getTextStyle(para) {
    try {
        return {
            font:     esc(para.appliedFont?para.appliedFont.fullName:"Arial"),
            fontSize: para.pointSize||12,
            leading:  (typeof para.leading==="number")?para.leading:(para.pointSize||12)*1.2,
            tracking: para.tracking||0,
            color:    colorRGB(para.fillColor),
            bold:     !!(para.fontStyle&&para.fontStyle.toLowerCase().indexOf("bold")>-1),
            italic:   !!(para.fontStyle&&para.fontStyle.toLowerCase().indexOf("italic")>-1),
            align:    String(para.justification),
            underline:!!(para.underline),
            caps:     String(para.capitalization||"")
        };
    } catch(e) { return {font:"Arial",fontSize:12,leading:14.4,tracking:0,color:[0,0,0],bold:false,italic:false,align:"LEFT_ALIGN",underline:false,caps:""}; }
}

function flattenSel(arr) {
    var out=[]; for(var i=0;i<arr.length;i++){var s=arr[i];if(s.constructor.name==="Group"){var k=flattenSel(s.allPageItems);for(var j=0;j<k.length;j++)out.push(k[j]);}else out.push(s);}return out;
}

function collectSelection() {
    if(!app.documents.length) return JSON.stringify({error:"No document open."});
    var doc=app.activeDocument;
    var sel=doc.selection;
    if(!sel||sel.length===0) return JSON.stringify({error:"Nothing selected."});

    var items=flattenSel(sel);
    var page; try{page=items[0].parentPage;}catch(e){page=doc.pages[0];} if(!page)page=doc.pages[0];
    var docW=page.bounds[3]-page.bounds[1], docH=page.bounds[2]-page.bounds[0];

    var layerMap={},layerOrder=[];
    for(var ii=0;ii<items.length;ii++){
        var item=items[ii];
        var ln="Layer 1",lv=true,ll2=false;
        try{ln=item.itemLayer.name;lv=item.itemLayer.visible;ll2=item.itemLayer.locked;}catch(e){}
        if(!layerMap[ln]){layerMap[ln]={name:esc(ln),visible:lv,locked:ll2,items:[]};layerOrder.push(ln);}

        var gb=item.geometricBounds;
        var x=gb[1]-page.bounds[1],y=gb[0]-page.bounds[0],w=gb[3]-gb[1],h=gb[2]-gb[0];
        if(w<0.5&&h<0.5)continue;
        var cn=item.constructor.name;

        var itm={id:ii,name:esc(item.label||cn+"_"+ii),type:"unknown",
            x:x,y:y,w:w,h:h,cx:x+w/2,cy:y+h/2,
            rotation:getRotation(item),opacity:getOpacity(item),
            fill:getFill(item),stroke:getStroke(item)};

        if(cn==="TextFrame"){
            itm.type="text"; itm.fullText=esc(item.contents);
            var pp=[],paras=item.paragraphs;
            for(var pi=0;pi<paras.length;pi++){
                var para=paras[pi]; if(para.contents==="")continue;
                var st=getTextStyle(para);
                pp.push({text:esc(para.contents),font:st.font,fontSize:st.fontSize,leading:st.leading,tracking:st.tracking,color:st.color,bold:st.bold,italic:st.italic,align:st.align,underline:st.underline,caps:st.caps});
            }
            itm.paragraphs=pp;
        } else if(cn==="Rectangle"||cn==="Oval"||cn==="Polygon"||cn==="GraphicLine"){
            var hg=false; if(cn==="Rectangle"){try{hg=item.graphics.length>0&&!!item.graphics[0].itemLink;}catch(e){}}
            if(hg){itm.type="image";try{itm.imagePath=esc(item.graphics[0].itemLink.filePath);}catch(e){itm.imagePath="";}}
            else{itm.type=cn.toLowerCase();if(cn==="Polygon"){try{itm.sides=item.numberOfSides;itm.starInset=item.starInset;}catch(e){}}}
            if(cn==="Rectangle"){try{itm.cornerRadius=item.cornerRadius||0;}catch(e){itm.cornerRadius=0;}}
        } else if(cn==="Image"||cn==="EPS"||cn==="PDF"){
            itm.type="image";try{itm.imagePath=esc(item.itemLink?item.itemLink.filePath:"");}catch(e){itm.imagePath="";}
        }
        layerMap[ln].items.push(itm);
    }

    // Serialize
    function ja(a){return"["+a.join(",")+"]";}
    var ls=[];
    for(var li=0;li<layerOrder.length;li++){
        var lay=layerMap[layerOrder[li]],is=[];
        for(var ii2=0;ii2<lay.items.length;ii2++){
            var itm2=lay.items[ii2];
            var sk=itm2.stroke?('{"color":'+ja(itm2.stroke.color)+',"width":'+itm2.stroke.width+'}'):"null";
            var s='{"id":'+itm2.id+',"name":"'+itm2.name+'","type":"'+itm2.type+'"'
               +',"x":'+itm2.x+',"y":'+itm2.y+',"w":'+itm2.w+',"h":'+itm2.h
               +',"cx":'+itm2.cx+',"cy":'+itm2.cy+',"rotation":'+itm2.rotation+',"opacity":'+itm2.opacity
               +',"fill":'+(itm2.fill?ja(itm2.fill):"null")+',"stroke":'+sk;
            if(itm2.type==="text"){
                var pstrs=[];
                for(var pi2=0;pi2<itm2.paragraphs.length;pi2++){var p=itm2.paragraphs[pi2];pstrs.push('{"text":"'+p.text+'","font":"'+p.font+'","fontSize":'+p.fontSize+',"leading":'+p.leading+',"tracking":'+p.tracking+',"color":'+ja(p.color)+',"bold":'+p.bold+',"italic":'+p.italic+',"align":"'+p.align+'","underline":'+p.underline+',"caps":"'+p.caps+'"}');}
                s+=',"fullText":"'+itm2.fullText+'","paragraphs":['+pstrs.join(",")+']';
            } else if(itm2.type==="image"){s+=',"imagePath":"'+(itm2.imagePath||"")+'","cornerRadius":0';}
            else if(itm2.type==="rectangle"){s+=',"cornerRadius":'+(itm2.cornerRadius||0);}
            else if(itm2.type==="polygon"){s+=',"sides":'+(itm2.sides||6)+',"starInset":'+(itm2.starInset||0);}
            s+='}'; is.push(s);
        }
        ls.push('{"name":"'+lay.name+'","visible":'+lay.visible+',"locked":'+lay.locked+',"items":['+is.join(",")+']}'
        );
    }

    var total=0; for(var li2=0;li2<layerOrder.length;li2++) total+=layerMap[layerOrder[li2]].items.length;
    return JSON.stringify({success:true,source:"IDSN",docName:esc(doc.name),docW:docW,docH:docH,selectedCount:total,layers:JSON.parse('['+ls.join(",")+']')});
}

function getSelectionInfo() {
    if(!app.documents.length) return JSON.stringify({count:0,message:"No document open"});
    var doc=app.activeDocument,sel=doc.selection;
    if(!sel||sel.length===0) return JSON.stringify({count:0,message:"Nothing selected"});
    var flat=flattenSel(sel),types={};
    for(var i=0;i<flat.length;i++){var cn=flat[i].constructor.name;types[cn]=(types[cn]||0)+1;}
    var tl=[];for(var k in types)tl.push(types[k]+"x "+k);
    return JSON.stringify({count:flat.length,types:tl,message:flat.length+" item"+(flat.length!==1?"s":"")+" selected"});
}
