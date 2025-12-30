/*\
title: $:/plugins/tiddlywiki/editor/registers/registers.js
type: application/javascript
module-type: editor-plugin

Vim-style named registers for copy/paste.

Plugin Metadata:
- name: registers
- configTiddler: $:/config/Editor/EnableRegisters
- defaultEnabled: false

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "registers";
exports.configTiddler = "$:/config/Editor/EnableRegisters";
exports.defaultEnabled = false;
exports.description = "Vim-style named registers for copy/paste";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new RegistersPlugin(engine); };

function RegistersPlugin(engine){
	this.engine = engine;
	this.name = "registers";
	this.enabled = false;

	if(!engine._twRegisters) engine._twRegisters = { '"': "" };

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this)
	};
}

RegistersPlugin.prototype.enable = function(){ this.enabled = true; };
RegistersPlugin.prototype.disable = function(){ this.enabled = false; };

RegistersPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;
	if(!ctrl || !event.altKey) return;

	if(event.key === "c" || event.key === "C") {
		event.preventDefault();
		this.copyToRegister();
		return false;
	}
	if(event.key === "v" || event.key === "V") {
		event.preventDefault();
		this.pasteFromRegister();
		return false;
	}
};

RegistersPlugin.prototype.promptRegister = function(msg){
	var r = prompt(msg + " (a-z or \")", "a");
	if(!r) return null;
	r = r[0];
	if(r !== '"' && !/[a-z]/i.test(r)) return null;
	return r;
};

RegistersPlugin.prototype.copyToRegister = function(){
	var ta = this.engine.domNode;
	var s = ta.selectionStart, e = ta.selectionEnd;
	if(s === e) return;

	var r = this.promptRegister("Copy selection to register");
	if(!r) return;

	var text = ta.value.substring(s, e);
	this.engine._twRegisters[r] = text;
	this.engine._twRegisters['"'] = text;

	// Also copy to system clipboard (best effort)
	if(navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).catch(function(){});
	}
};

RegistersPlugin.prototype.pasteFromRegister = function(){
	var r = this.promptRegister("Paste from register");
	if(!r) return;

	var ins = this.engine._twRegisters[r] || "";
	if(!ins) return;

	// Multi-cursor safe insert if available
	if(this.engine.insertAtAllCursors) {
		this.engine.insertAtAllCursors(ins);
		return;
	}

	var engine = this.engine, ta = engine.domNode, text = ta.value;
	var s = ta.selectionStart, e = ta.selectionEnd;

	engine.captureBeforeState && engine.captureBeforeState();
	ta.value = text.substring(0, s) + ins + text.substring(e);
	var p = s + ins.length;
	ta.selectionStart = p; ta.selectionEnd = p;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};