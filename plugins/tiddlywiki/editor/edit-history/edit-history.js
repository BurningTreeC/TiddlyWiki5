/*\
title: $:/plugins/tiddlywiki/editor/edit-history/edit-history.js
type: application/javascript
module-type: editor-plugin

Periodic snapshots for browsing edit history.

Plugin Metadata:
- name: edit-history
- configTiddler: $:/config/Editor/EnableEditHistory
- defaultEnabled: false

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "edit-history";
exports.configTiddler = "$:/config/Editor/EnableEditHistory";
exports.defaultEnabled = false;
exports.description = "Periodic snapshots for browsing edit history";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new EditHistoryPlugin(engine); };

function EditHistoryPlugin(engine){
	this.engine = engine;
	this.name = "edit-history";
	this.enabled = false;

	this.snapshots = []; // {t, text, selStart, selEnd}
	this.max = 50;
	this.timer = null;
	this.delay = 800;

	this.hooks = {
		afterInput: this.onAfterInput.bind(this),
		beforeKeydown: this.onKeydown.bind(this),
		focus: this.onFocus.bind(this)
	};
}

EditHistoryPlugin.prototype.enable = function(){ this.enabled = true; this.capture(true); };
EditHistoryPlugin.prototype.disable = function(){ this.enabled = false; this.snapshots = []; };

EditHistoryPlugin.prototype.onFocus = function(){ if(this.enabled) this.capture(true); };

EditHistoryPlugin.prototype.onAfterInput = function(){
	if(!this.enabled) return;
	var self = this;
	if(this.timer) clearTimeout(this.timer);
	this.timer = setTimeout(function(){ self.capture(false); }, this.delay);
};

EditHistoryPlugin.prototype.capture = function(force){
	var ta = this.engine.domNode;
	var text = ta.value;
	var last = this.snapshots[this.snapshots.length - 1];
	if(!force && last && last.text === text) return;

	this.snapshots.push({
		t: Date.now(),
		text: text,
		selStart: ta.selectionStart,
		selEnd: ta.selectionEnd
	});
	if(this.snapshots.length > this.max) this.snapshots.shift();
};

EditHistoryPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;

	if(ctrl && event.altKey && !event.shiftKey && (event.key === "h" || event.key === "H")) {
		event.preventDefault();
		this.openPicker();
		return false;
	}
};

EditHistoryPlugin.prototype.openPicker = function(){
	if(!this.snapshots.length) return;

	var labels = this.snapshots.map(function(s, idx){
		var d = new Date(s.t);
		return idx + ": " + d.toLocaleTimeString();
	}).join("\n");

	var pick = prompt("Pick snapshot index:\n" + labels, String(this.snapshots.length - 1));
	if(pick === null) return;

	var idx = Math.max(0, Math.min(this.snapshots.length - 1, parseInt(pick, 10) || 0));
	var s = this.snapshots[idx];

	var engine = this.engine, ta = engine.domNode;
	engine.captureBeforeState && engine.captureBeforeState();
	ta.value = s.text;
	ta.selectionStart = s.selStart;
	ta.selectionEnd = s.selEnd;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};