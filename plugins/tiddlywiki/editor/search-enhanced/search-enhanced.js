/*\
title: $:/plugins/tiddlywiki/editor/search-enhanced/search-enhanced.js
type: application/javascript
module-type: editor-plugin

In-editor search with highlighting and multi-cursor selection.

Plugin Metadata:
- name: search-enhanced
- configTiddler: $:/config/Editor/EnableSearchEnhanced
- defaultEnabled: true

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "search-enhanced";
exports.configTiddler = "$:/config/Editor/EnableSearchEnhanced";
exports.defaultEnabled = true;
exports.description = "In-editor search with highlighting and multi-cursor selection";
exports.category = "navigation";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new SearchEnhancedPlugin(engine); };

function SearchEnhancedPlugin(engine){
	this.engine = engine;
	this.name = "search-enhanced";
	this.enabled = false;

	this.ui = null;
	this.input = null;
	this.matches = [];
	this.active = false;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		afterInput: this.onInput.bind(this),
		render: this.onRender.bind(this),
		blur: this.onBlur.bind(this)
	};
}

SearchEnhancedPlugin.prototype.enable = function(){ this.enabled = true; };
SearchEnhancedPlugin.prototype.disable = function(){
	this.enabled = false;
	this.close();
};

SearchEnhancedPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;

	if(ctrl && !event.shiftKey && !event.altKey && (event.key === "f" || event.key === "F")) {
		event.preventDefault();
		this.open();
		return false;
	}

	if(this.active) {
		if(event.key === "Escape") {
			event.preventDefault();
			this.close();
			return false;
		}
		if(ctrl && event.key === "Enter") {
			event.preventDefault();
			this.selectAllMatchesAsCursors();
			return false;
		}
	}
};

SearchEnhancedPlugin.prototype.onInput = function(){
	if(!this.active) return;
	this.recompute();
};

SearchEnhancedPlugin.prototype.onRender = function(){
	if(!this.active) return;
	this.renderHighlights();
};

SearchEnhancedPlugin.prototype.onBlur = function(){
	// keep open unless you want auto-close
};

SearchEnhancedPlugin.prototype.open = function(){
	if(this.active) return;
	this.active = true;

	var doc = this.engine.widget.document;
	var wrap = this.engine.wrapperNode;

	this.ui = doc.createElement("div");
	this.ui.className = "tc-search-bar";

	this.input = doc.createElement("input");
	this.input.className = "tc-search-input";
	this.input.type = "text";
	this.input.placeholder = "Searchâ€¦ (Ctrl+Enter: multi-cursor, Esc: close)";
	this.ui.appendChild(this.input);

	wrap.appendChild(this.ui);

	var self = this;
	this.input.addEventListener("input", function(){ self.recompute(); });
	this.input.addEventListener("keydown", function(e){
		if(e.key === "Escape") { e.preventDefault(); self.close(); }
	});

	this.input.focus();
	this.recompute();
};

SearchEnhancedPlugin.prototype.close = function(){
	this.active = false;
	this.clearHighlights();
	this.matches = [];

	if(this.ui && this.ui.parentNode) this.ui.parentNode.removeChild(this.ui);
	this.ui = null;
	this.input = null;
};

SearchEnhancedPlugin.prototype.recompute = function(){
	this.matches = [];
	this.clearHighlights();

	if(!this.input) return;
	var q = this.input.value;
	if(!q) { this.engine.renderCursors && this.engine.renderCursors(); return; }

	var text = this.engine.domNode.value;
	var idx = 0;
	while(true) {
		idx = text.indexOf(q, idx);
		if(idx === -1) break;
		this.matches.push({ start: idx, end: idx + q.length });
		idx = idx + Math.max(1, q.length);
	}

	this.renderHighlights();
};

SearchEnhancedPlugin.prototype.clearHighlights = function(){
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;
	var existing = layer.querySelectorAll(".tc-search-hit");
	for(var i=0;i<existing.length;i++) existing[i].remove();
};

SearchEnhancedPlugin.prototype.renderHighlights = function(){
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;
	this.clearHighlights();

	for(var i=0;i<this.matches.length;i++) {
		var m = this.matches[i];
		var rects = this.engine.getRectsForRange ? this.engine.getRectsForRange(m.start, m.end) : null;
		if(!rects || rects.length === 0) continue;

		for(var r=0;r<rects.length;r++) {
			var el = this.engine.getDocument().createElement("div");
			el.className = "tc-search-hit";
			el.style.left = rects[r].left + "px";
			el.style.top = rects[r].top + "px";
			el.style.width = rects[r].width + "px";
			el.style.height = rects[r].height + "px";
			layer.appendChild(el);
		}
	}
};

SearchEnhancedPlugin.prototype.selectAllMatchesAsCursors = function(){
	if(!this.matches.length) return;
	if(!this.engine.addCursor) return;

	var engine = this.engine;
	engine.clearSecondaryCursors && engine.clearSecondaryCursors();

	// Set primary to first match
	var ta = engine.domNode;
	ta.selectionStart = this.matches[0].start;
	ta.selectionEnd = this.matches[0].end;
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();

	// Add cursors for the rest
	for(var i=1;i<this.matches.length;i++) {
		engine.addCursor(this.matches[i].end, { start: this.matches[i].start, end: this.matches[i].end });
	}

	engine.sortAndMergeCursors && engine.sortAndMergeCursors();
	engine.renderCursors && engine.renderCursors();
};