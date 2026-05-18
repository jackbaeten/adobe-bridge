// AE Bridge - After Effects ExtendScript
// Builds comp from bridge payload

var COMP_DURATION = 10;
var COMP_FPS = 25;

function toAEC(rgb){ if(!rgb)return[0,0,0,1]; return[rgb[0]/255,rgb[1]/255,rgb[2]/255,1]; }

function toAEJust(align){
    var a=String(align).toUpperCase();
    if(a.indexOf("CENTER")>-1)return ParagraphJustification.CENTER_JUSTIFY;
    if(a.indexOf("RIGHT")>-1)return ParagraphJustification.RIGHT_JUSTIFY;
    if(a.indexOf("FULL")>-1)return ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT;
    return ParagraphJustification.LEFT_JUSTIFY;
}

function buildComp(jsonStr) {
    var data; try{data=eval("("+jsonStr+")");}catch(e){return JSON.stringify({error:"Parse failed: "+e.toString()});}

    app.beginUndoGroup("AE Bridge Import");
    var artboard=data.artboard||{};
    var compW=Math.max(1,Math.round((artboard.width||data.docW||1920)));
    var compH=Math.max(1,Math.round((artboard.height||data.docH||1080)));

    var comp=app.project.items.addComp(artboard.name||data.docName||"Bridge Import",compW,compH,1,COMP_DURATION,COMP_FPS);
    var layers=data.layers||[];
    var built=0;

    for(var li=layers.length-1;li>=0;li--){
        var idLayer=layers[li],items=idLayer.items||[];
        for(var ii=items.length-1;ii>=0;ii--){
            var itm=items[ii];
            var posX=itm.cx,posY=itm.cy;
            var pw=Math.max(1,itm.w),ph=Math.max(1,itm.h);
            var rot=-(itm.rotation||0);
            var op=itm.opacity||100;

            if(itm.type==="text"){
                var tl=comp.layers.addText();
                tl.name=itm.name+" ["+idLayer.name+"]";
                var tp=tl.property("Source Text"),td=tp.value;
                var full="",pp=itm.paragraphs||[];
                for(var pi=0;pi<pp.length;pi++){full+=pp[pi].text;if(pi<pp.length-1)full+="\r";}
                if(!full)full=itm.fullText||"";
                td.text=full;
                if(pp.length>0){
                    var fp=pp[0];
                    td.fontSize=fp.fontSize;td.fillColor=toAEC(fp.color);
                    td.justification=toAEJust(fp.align);td.trackingAmount=fp.tracking||0;
                    td.leading=fp.leading||(fp.fontSize*1.2);
                    try{td.font=fp.font;}catch(e){try{td.font="Arial";}catch(e2){}}
                    td.applyFill=true;td.applyStroke=false;
                }
                tp.setValue(td);
                try{var td2=tp.value;td2.boxText=true;td2.boxTextSize=[pw,ph];tp.setValue(td2);}catch(e){}
                var tf=tl.property("Transform");
                tf.property("Position").setValue([posX,posY]);
                tf.property("Rotation").setValue(rot);
                tf.property("Opacity").setValue(op);
                if(itm.fill){
                    var bg=comp.layers.addSolid(toAEC(itm.fill),itm.name+"_bg",Math.round(pw),Math.round(ph),1);
                    var bgtf=bg.property("Transform");
                    bgtf.property("Position").setValue([posX,posY]);
                    bgtf.property("Rotation").setValue(rot);
                    bgtf.property("Opacity").setValue(op);
                    bg.moveAfter(tl);
                }
                if(!idLayer.visible)tl.enabled=false;
                built++;

            } else if(itm.type==="rectangle"||itm.type==="oval"||itm.type==="polygon"||itm.type==="graphicline"){
                var sl=comp.layers.addShape();
                sl.name=itm.name+" ["+idLayer.name+"]";
                var contents=sl.property("Contents"),grp=contents.addProperty("ADBE Vector Group"),grpC=grp.property("Contents");

                if(itm.type==="rectangle"){
                    var rect=grpC.addProperty("ADBE Vector Shape - Rect");
                    rect.property("ADBE Vector Rect Size").setValue([pw,ph]);
                    rect.property("ADBE Vector Rect Position").setValue([0,0]);
                    if(itm.cornerRadius&&itm.cornerRadius>0){try{rect.property("ADBE Vector Rect Roundness").setValue(itm.cornerRadius);}catch(e){}}
                } else if(itm.type==="oval"){
                    var ell=grpC.addProperty("ADBE Vector Shape - Ellipse");
                    ell.property("ADBE Vector Ellipse Size").setValue([pw,ph]);
                    ell.property("ADBE Vector Ellipse Position").setValue([0,0]);
                } else if(itm.type==="polygon"){
                    var poly=grpC.addProperty("ADBE Vector Shape - Star");
                    poly.property("ADBE Vector Star Type").setValue(1);
                    poly.property("ADBE Vector Star Points").setValue(itm.sides||6);
                    poly.property("ADBE Vector Star Outer Radius").setValue(Math.min(pw,ph)/2);
                    poly.property("ADBE Vector Star Position").setValue([0,0]);
                } else if(itm.type==="graphicline"){
                    try{var lpg=grpC.addProperty("ADBE Vector Shape - Group"),lp=new ShapePath();lp.vertices=[[-pw/2,0],[pw/2,0]];lp.closed=false;lpg.property("ADBE Vector Shape").setValue(lp);}catch(e){}
                }

                if(itm.fill){var fill=grpC.addProperty("ADBE Vector Graphic - Fill");fill.property("ADBE Vector Fill Color").setValue(toAEC(itm.fill));}
                else{var nf=grpC.addProperty("ADBE Vector Graphic - Fill");nf.property("ADBE Vector Fill Color").setValue([0,0,0,0]);try{nf.property("ADBE Vector Fill Opacity").setValue(0);}catch(e){}}
                if(itm.stroke){var strk=grpC.addProperty("ADBE Vector Graphic - Stroke");strk.property("ADBE Vector Stroke Color").setValue(toAEC(itm.stroke.color));strk.property("ADBE Vector Stroke Width").setValue(itm.stroke.width);}

                var stf=sl.property("Transform");
                stf.property("Position").setValue([posX,posY]);
                stf.property("Rotation").setValue(rot);
                stf.property("Opacity").setValue(op);
                if(!idLayer.visible)sl.enabled=false;
                built++;

            } else if(itm.type==="image"){
                var imgPath=itm.imagePath||"",imgFile=new File(imgPath);
                if(imgFile.exists){
                    try{
                        var footage=app.project.importFile(new ImportOptions(imgFile));
                        footage.name=itm.name;
                        var imgL=comp.layers.add(footage);
                        imgL.name=itm.name+" ["+idLayer.name+"]";
                        var itf=imgL.property("Transform");
                        itf.property("Position").setValue([posX,posY]);
                        itf.property("Rotation").setValue(rot);
                        itf.property("Opacity").setValue(op);
                        var srcW=footage.width||pw,srcH=footage.height||ph;
                        itf.property("Scale").setValue([(pw/srcW)*100,(ph/srcH)*100]);
                        if(!idLayer.visible)imgL.enabled=false;
                        built++;
                    }catch(e){
                        var ph2=comp.layers.addSolid([.5,.5,.5,1],itm.name+" [IMG]",Math.round(pw),Math.round(ph),1);
                        ph2.property("Transform").property("Position").setValue([posX,posY]);built++;
                    }
                } else {
                    var fname=(imgPath.split("/").pop()||"").split("\\").pop()||"missing";
                    var ph3=comp.layers.addSolid([.3,.3,.3,1],itm.name+" [MISSING:"+fname+"]",Math.round(pw),Math.round(ph),1);
                    ph3.property("Transform").property("Position").setValue([posX,posY]);
                    ph3.property("Transform").property("Rotation").setValue(rot);built++;
                }
            }
        }
    }
    comp.openInViewer();
    app.endUndoGroup();
    return JSON.stringify({success:true,compName:comp.name,layers:built});
}
