/*\
title: $:/plugins/tiddlywiki/editor/folding/folding.js
type: application/javascript
module-type: editor-plugin
\*/
"use strict";

exports.create = function(engine){ return new FoldingPlugin(engine); };


// ==================== PLUGIN METADATA ====================
exports.name = "folding";
exports.configTiddler = "$:/config/Editor/EnableFolding";
exports.configTiddlerAlt = "$:/config/EnableFolding";
exports.defaultEnabled = true;
exports.description = "Fold/unfold sections in the editor";
exports.category = "display";

// ==================== PLUGIN IMPLEMENTATION ====================

function FoldingPlugin(engine){
	this.engine = engine;
	this.name = "folding";
	this.enabled = false;

	this.folds = {}; // key: sectionStartPos -> boolean folded
	this.overlayEls = [];

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		afterInput: this.onAfterInput.bind(this),
		render: this.onRender.bind(this)
	};
}

FoldingPlugin.prototype.enable = function(){ this.enabled = true; this.recompute(); };
FoldingPlugin.prototype.disable = function(){
	this.enabled = false;
	this.clearOverlay();
	this.folds = {};
};

FoldingPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;

	// Ctrl+Shift+[
	if(ctrl && event.shiftKey && event.key === "[") {
		event.preventDefault();
		this.foldCurrentSection(true);
		return false;
	}
	// Ctrl+Shift+]
	if(ctrl && event.shiftKey && event.key === "]") {
		event.preventDefault();
		this.foldCurrentSection(false);
		return false;
	}
};

FoldingPlugin.prototype.onAfterInput = function(){
	if(!this.enabled) return;
	this.recompute();
};

FoldingPlugin.prototype.onRender = function(){
	if(!this.enabled) return;
	this.renderOverlay();
};

FoldingPlugin.prototype.clearOverlay = function(){
	var layer = this.engine.getOverlayLayer && this.engine.getOverlayLayer();
	for(var i=0;i<this.overlayEls.length;i++){
		if(this.overlayEls[i].parentNode) this.overlayEls[i].parentNode.removeChild(this.overlayEls[i]);
	}
	this.overlayEls = [];
};

FoldingPlugin.prototype.getSections = function(text){
	// sections by headings; returns [{start,end,level}]
	var lines = text.split("\n");
	var starts = [];
	var pos = 0;
	for(var i=0;i<lines.length;i++){
		var m = lines[i].match(/^(!{1,6})\s/);
		if(m) starts.push({ line:i, pos:pos, level:m[1].length });
		pos += lines[i].length + 1;
	}

	var secs = [];
	for(i=0;i<starts.length;i++){
		var s = starts[i];
		var end = text.length;
		for(var j=i+1;j<starts.length;j++){
			if(starts[j].level <= s.level) { end = starts[j].pos; break; }
		}
		secs.push({ start:s.pos, end:end, level:s.level, line:s.line });
	}
	return secs;
};

FoldingPlugin.prototype.recompute = function(){
	this.sections = this.getSections(this.engine.domNode.value);
	this.renderOverlay();
};

FoldingPlugin.prototype.foldCurrentSection = function(fold){
	var ta = this.engine.domNode;
	var pos = ta.selectionStart;
	var secs = this.sections || [];
	var cur = null;
	for(var i=0;i<secs.length;i++){
		if(pos >= secs[i].start && pos < secs[i].end) { cur = secs[i]; break; }
	}
	if(!cur) return;
	this.folds[cur.start] = fold;
	this.renderOverlay();
};

FoldingPlugin.prototype.renderOverlay = function(){
	this.clearOverlay();
	var layer = this.engine.getOverlayLayer && this.engine.getOverlayLayer();
	if(!layer) return;

	var doc = this.engine.getDocument();
	var ta = this.engine.domNode;
	var text = ta.value;

	for(var i=0;i<(this.sections||[]).length;i++){
		var sec = this.sections[i];
		if(!this.folds[sec.start]) continue;

		// mask from first content line after heading to section end
		var headingEnd = text.indexOf("\n", sec.start);
		if(headingEnd === -1) continue;
		var foldStart = headingEnd + 1;
		if(foldStart >= sec.end) continue;

		var startCoords = this.engine.getCoordinatesForPosition(foldStart);
		var endCoords = this.engine.getCoordinatesForPosition(sec.end);
		if(!startCoords || !endCoords) continue;

		// Big cover block (best-effort)
		var cover = doc.createElement("div");
		cover.className = "tc-fold-cover";
		cover.style.left = "0px";
		cover.style.top = startCoords.top + "px";
		cover.style.right = "0px";
		cover.style.height = Math.max(16, (endCoords.top - startCoords.top) + endCoords.height) + "px";

		// Ellipsis line
		var ell = doc.createElement("div");
		ell.className = "tc-fold-ellipsis";
		ell.style.left = "0px";
		ell.style.top = startCoords.top + "px";
		ell.textContent = "â€¦ (folded)";

		// allow click to unfold
		cover.style.pointerEvents = "auto";
		ell.style.pointerEvents = "auto";
		var self = this;
		(function(secStart){
			cover.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); self.folds[secStart] = false; self.renderOverlay(); });
			ell.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); self.folds[secStart] = false; self.renderOverlay(); });
		})(sec.start);

		layer.appendChild(cover);
		layer.appendChild(ell);
		this.overlayEls.push(cover, ell);
	}
};