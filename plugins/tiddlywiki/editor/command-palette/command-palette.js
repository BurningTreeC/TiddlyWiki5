/*\
title: $:/plugins/tiddlywiki/editor/command-palette/command-palette.js
type: application/javascript
module-type: editor-plugin
\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "command-palette";
exports.configTiddler = "$:/config/Editor/EnableCommandPalette";
exports.configTiddlerAlt = "$:/config/EnableCommandPalette";
exports.defaultEnabled = true;
exports.description = "Quick command access via Ctrl+Shift+P";
exports.category = "navigation";

// ==================== PLUGIN IMPLEMENTATION ====================


exports.create = function(engine){ return new CommandPalettePlugin(engine); };

function CommandPalettePlugin(engine){
	this.engine = engine;
	this.name = "command-palette";
	this.enabled = false;

	this.ui = null;
	this.input = null;
	this.list = null;
	this.items = [];
	this.filtered = [];
	this.sel = 0;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this)
	};
}

CommandPalettePlugin.prototype.enable = function(){ this.enabled = true; };
CommandPalettePlugin.prototype.disable = function(){ this.enabled = false; this.close(); };

CommandPalettePlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;

	if(ctrl && event.shiftKey && !event.altKey && (event.key === "P" || event.key === "p")) {
		event.preventDefault();
		this.open();
		return false;
	}

	if(this.ui) {
		if(event.key === "Escape") { event.preventDefault(); this.close(); return false; }
		if(event.key === "ArrowDown") { event.preventDefault(); this.move(1); return false; }
		if(event.key === "ArrowUp") { event.preventDefault(); this.move(-1); return false; }
		if(event.key === "Enter") { event.preventDefault(); this.runSelected(); return false; }
	}
};

CommandPalettePlugin.prototype.open = function(){
	if(this.ui) return;

	var doc = this.engine.widget.document;
	var wrap = this.engine.wrapperNode;

	this.ui = doc.createElement("div");
	this.ui.className = "tc-cmdpal";

	this.input = doc.createElement("input");
	this.input.className = "tc-cmdpal-input";
	this.input.type = "text";
	this.input.placeholder = "Type a commandâ€¦";
	this.ui.appendChild(this.input);

	this.list = doc.createElement("div");
	this.list.className = "tc-cmdpal-list";
	this.ui.appendChild(this.list);

	wrap.appendChild(this.ui);

	this.items = this.buildCommands();
	this.filtered = this.items.slice();
	this.sel = 0;

	var self = this;
	this.input.addEventListener("input", function(){ self.filter(self.input.value); });
	this.input.addEventListener("keydown", function(e){
		if(e.key === "Escape"){ e.preventDefault(); self.close(); }
	});

	this.render();
	this.input.focus();
};

CommandPalettePlugin.prototype.close = function(){
	if(!this.ui) return;
	this.ui.remove();
	this.ui = this.input = this.list = null;
	this.filtered = [];
	this.sel = 0;
};

CommandPalettePlugin.prototype.buildCommands = function(){
	var engine = this.engine;
	var plugin = function(name){ return engine.getPlugin && engine.getPlugin(name); };

	return [
		{ name:"Toggle Vim Mode", run:function(){ var p=plugin("vim-mode"); if(p){ p.enabled ? p.disable() : p.enable(); } } },
		{ name:"Toggle Multi-Cursor", run:function(){ var p=plugin("multi-cursor"); if(p){ p.enabled ? p.disable() : p.enable(); } } },
		{ name:"Toggle Smart Pairs", run:function(){ var p=plugin("smart-pairs"); if(p){ p.enabled ? p.disable() : p.enable(); } } },
		{ name:"Fold Current Section", run:function(){ var p=plugin("folding"); if(p){ p.foldCurrentSection(true); } } },
		{ name:"Unfold Current Section", run:function(){ var p=plugin("folding"); if(p){ p.foldCurrentSection(false); } } },
		{ name:"Go to Lineâ€¦", run:function(){
			var n = prompt("Go to line:", "1");
			if(!n) return;
			var line = Math.max(1, parseInt(n,10) || 1);
			var pos = engine.getPositionForLineColumn ? engine.getPositionForLineColumn(line-1, 0) : 0;
			engine.domNode.selectionStart = pos;
			engine.domNode.selectionEnd = pos;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
		}}
	];
};

CommandPalettePlugin.prototype.filter = function(q){
	q = (q||"").toLowerCase();
	this.filtered = this.items.filter(function(it){ return it.name.toLowerCase().indexOf(q) !== -1; });
	this.sel = 0;
	this.render();
};

CommandPalettePlugin.prototype.render = function(){
	if(!this.list) return;
	this.list.innerHTML = "";
	for(var i=0;i<this.filtered.length;i++){
		var row = this.engine.widget.document.createElement("div");
		row.className = "tc-cmdpal-item" + (i===this.sel ? " is-selected":"");
		row.textContent = this.filtered[i].name;
		this.list.appendChild(row);
	}
};

CommandPalettePlugin.prototype.move = function(d){
	if(!this.filtered.length) return;
	this.sel = Math.max(0, Math.min(this.filtered.length-1, this.sel + d));
	this.render();
};

CommandPalettePlugin.prototype.runSelected = function(){
	if(!this.filtered.length) return;
	var cmd = this.filtered[this.sel];
	this.close();
	try { cmd.run(); } catch(e) { console.error(e); }
};