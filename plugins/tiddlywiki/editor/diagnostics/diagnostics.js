/*\
title: $:/plugins/tiddlywiki/editor/diagnostics/diagnostics.js
type: application/javascript
module-type: editor-plugin

Real-time diagnostics for unbalanced wikitext tokens.

Plugin Metadata:
- name: diagnostics
- configTiddler: $:/config/Editor/EnableDiagnostics
- defaultEnabled: false

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "diagnostics";
exports.configTiddler = "$:/config/Editor/EnableDiagnostics";
exports.defaultEnabled = false;
exports.description = "Real-time diagnostics for unbalanced wikitext tokens";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new DiagnosticsPlugin(engine); };

function DiagnosticsPlugin(engine){
	this.engine = engine;
	this.name = "diagnostics";
	this.enabled = false;

	this.timer = null;
	this.delay = 200;

	this.hooks = {
		afterInput: this.onAfterInput.bind(this),
		render: this.onRender.bind(this),
		blur: this.onBlur.bind(this)
	};
}

DiagnosticsPlugin.prototype.enable = function(){ this.enabled = true; this.schedule(); };
DiagnosticsPlugin.prototype.disable = function(){ this.enabled = false; this.clear(); };

DiagnosticsPlugin.prototype.onAfterInput = function(){
	if(!this.enabled) return;
	this.schedule();
};

DiagnosticsPlugin.prototype.onRender = function(){
	if(!this.enabled) return;
	// overlays are re-rendered on schedule
};

DiagnosticsPlugin.prototype.onBlur = function(){
	// keep visible
};

DiagnosticsPlugin.prototype.schedule = function(){
	var self = this;
	if(this.timer) clearTimeout(this.timer);
	this.timer = setTimeout(function(){ self.update(); }, this.delay);
};

DiagnosticsPlugin.prototype.clear = function(){
	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;
	var els = layer.querySelectorAll(".tc-diagnostic");
	for(var i=0;i<els.length;i++) els[i].remove();
};

DiagnosticsPlugin.prototype.update = function(){
	if(!this.enabled) return;
	this.clear();

	var layer = this.engine.getDecorationLayer && this.engine.getDecorationLayer();
	if(!layer) return;

	var text = this.engine.domNode.value;

	// Check paired tokens by counting
	var problems = [];

	function countToken(tok){
		var c=0, i=0;
		while((i = text.indexOf(tok, i)) !== -1) { c++; i += tok.length; }
		return c;
	}

	// Symmetric tokens
	var sym = ["''","//","__","~~","^^",",,","```"];
	for(var i=0;i<sym.length;i++){
		if(countToken(sym[i]) % 2 !== 0) problems.push({ type:"unbalanced", token:sym[i] });
	}

	// Asymmetric pairs: count open/close
	function countPair(o,c){
		return { o: countToken(o), c: countToken(c) };
	}
	var p1 = countPair("[[","]]");
	if(p1.o !== p1.c) problems.push({ type:"unbalanced", token:"[[ ]]" });

	var p2 = countPair("{{","}}");
	if(p2.o !== p2.c) problems.push({ type:"unbalanced", token:"{{ }}" });

	var p3 = countPair("<<",">>");
	if(p3.o !== p3.c) problems.push({ type:"unbalanced", token:"<< >>" });

	// Render: show small warning badge at top-left if any problems
	if(problems.length) {
		var doc = this.engine.getDocument();
		var badge = doc.createElement("div");
		badge.className = "tc-diagnostic tc-diagnostic-badge";
		badge.textContent = "âš  " + problems.map(function(p){return p.token;}).join(", ");
		layer.appendChild(badge);
	}
};