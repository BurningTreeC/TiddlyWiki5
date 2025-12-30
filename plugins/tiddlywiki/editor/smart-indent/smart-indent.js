/*\
title: $:/plugins/tiddlywiki/editor/smart-indent/smart-indent.js
type: application/javascript
module-type: editor-plugin

Smart indentation: auto-indent on Enter, Tab indent/outdent.

Plugin Metadata:
- name: smart-indent
- configTiddler: $:/config/Editor/EnableSmartIndent
- defaultEnabled: true

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "smart-indent";
exports.configTiddler = "$:/config/Editor/EnableSmartIndent";
exports.defaultEnabled = true;
exports.description = "Smart indentation: auto-indent on Enter, Tab indent/outdent";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new SmartIndentPlugin(engine); };

function SmartIndentPlugin(engine){
	this.engine = engine;
	this.name = "smart-indent";
	this.enabled = false;
	this.indent = "\t";

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		beforeInput: this.onBeforeInput.bind(this)
	};
}

SmartIndentPlugin.prototype.enable = function(){ this.enabled = true; };
SmartIndentPlugin.prototype.disable = function(){ this.enabled = false; };

SmartIndentPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ta = this.engine.domNode;
	var ctrl = event.ctrlKey || event.metaKey;

	// Tab indentation
	if(event.key === "Tab" && !ctrl && !event.altKey) {
		event.preventDefault();
		if(event.shiftKey) this.outdent();
		else this.indentSelection();
		return false;
	}
};

SmartIndentPlugin.prototype.onBeforeInput = function(event){
	if(!this.enabled) return;
	if(event.inputType !== "insertLineBreak" && event.inputType !== "insertParagraph") return;

	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	var lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	var lineEnd = text.indexOf("\n", pos);
	if(lineEnd === -1) lineEnd = text.length;

	var line = text.substring(lineStart, lineEnd);

	// Compute base indentation
	var indentMatch = line.match(/^\s*/);
	var base = indentMatch ? indentMatch[0] : "";

	// List markers
	var listMatch = line.match(/^(\s*)([*#]+)\s+/);
	var colonMatch = line.match(/^(\s*):+/);

	// Code fences: if current line is ``` start/end, don't auto-indent beyond base
	var isFence = /^\s*```/.test(line);

	var extra = "";
	if(listMatch) extra = listMatch[2] + " ";
	else if(colonMatch) extra = line.match(/^(\s*:*)/)[0];

	var insert = "\n" + base + (isFence ? "" : extra);

	// Let engine multi-cursor handle if present; we force prevent default here
	event.preventDefault();
	this.engine.insertAtAllCursors ? this.engine.insertAtAllCursors(insert) : this.insertText(insert);
	return false;
};

SmartIndentPlugin.prototype.insertText = function(s){
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var a = ta.selectionStart, b = ta.selectionEnd;

	engine.captureBeforeState && engine.captureBeforeState();
	ta.value = text.slice(0,a) + s + text.slice(b);
	var p = a + s.length;
	ta.selectionStart = p; ta.selectionEnd = p;
	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

SmartIndentPlugin.prototype.indentSelection = function(){
	var engine = this.engine, ta = engine.domNode, text = ta.value;
	var s = ta.selectionStart, e = ta.selectionEnd;
	engine.captureBeforeState && engine.captureBeforeState();

	if(s === e) {
		this.insertText(this.indent);
		return;
	}

	var lineStart = text.lastIndexOf("\n", s - 1) + 1;
	var lineEnd = text.indexOf("\n", e);
	if(lineEnd === -1) lineEnd = text.length;

	var block = text.slice(lineStart, lineEnd);
	var out = block.split("\n").map(function(l){ return (l.length ? (engine.widget && engine.widget.editUseSpaces === "yes" ? "  " : "\t") : "") + l; }).join("\n");

	ta.value = text.slice(0, lineStart) + out + text.slice(lineEnd);
	ta.selectionStart = lineStart;
	ta.selectionEnd = lineStart + out.length;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

SmartIndentPlugin.prototype.outdent = function(){
	var engine = this.engine, ta = engine.domNode, text = ta.value;
	var s = ta.selectionStart, e = ta.selectionEnd;

	var lineStart = text.lastIndexOf("\n", s - 1) + 1;
	var lineEnd = text.indexOf("\n", e);
	if(lineEnd === -1) lineEnd = text.length;

	var block = text.slice(lineStart, lineEnd);
	engine.captureBeforeState && engine.captureBeforeState();

	var out = block.split("\n").map(function(l){
		if(l.startsWith("\t")) return l.slice(1);
		if(l.startsWith("  ")) return l.slice(2);
		return l.replace(/^ {1,2}/, "");
	}).join("\n");

	ta.value = text.slice(0, lineStart) + out + text.slice(lineEnd);
	ta.selectionStart = lineStart;
	ta.selectionEnd = lineStart + out.length;

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};